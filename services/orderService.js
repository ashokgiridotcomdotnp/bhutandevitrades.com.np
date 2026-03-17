import mongoose from 'mongoose';
import config from '../lib/config.js';
import database from '../lib/db.js';
import errors from '../lib/errors.js';
import logger from '../lib/logger.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import catalogService from './catalogService.js';
import resendService from './resendService.js';



let AppError = errors.AppError;
let adminOrderRequestsLimit = 150;
let adminOrderRequestsPageSize = 10;
let adminOrderListSelectFields = 'productId productName productType quantity totalLabel customerName customerEmail phoneNumber note createdAt adminAcceptedAt adminStatus';
let customerOrderListSelectFields = 'productName productType quantity unitPriceLabel totalLabel phoneNumber note customerName createdAt status adminStatus adminAcceptedAt productId';

function toTrimmedString(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return toTrimmedString(value).toLowerCase();
}

function isLikelyEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toTrimmedString(value));
}

function parsePositiveInteger(value, fallbackValue) {
  let parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return fallbackValue;
  }

  return Math.floor(parsedValue);
}

function parseAvailableStockQuantity(value) {
  let parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    return null;
  }

  return Math.max(0, Math.floor(parsedValue));
}

async function ensureDatabaseConnection() {
  if (await database.connectToDatabase()) {
    return true;
  }

  throw new AppError(503, 'db-unavailable', 'Database unavailable');
}

async function markOrderNotificationState(orderId, updates) {
  try {
    await Order.updateOne({ _id: orderId }, { $set: updates });
  } catch (error) {
    logger.error('Failed to update order notification state', {
      orderId: toTrimmedString(orderId),
      error: logger.serializeError(error),
    });
  }
}

function queueOrderNotificationEmails(orderRecord, orderData, options) {
  let notificationEmail = normalizeEmail(options && options.notificationEmail);
  let customerEmail = normalizeEmail(options && options.customerEmail);
  let shouldSendCustomerConfirmation = Boolean(options && options.shouldSendCustomerConfirmation);
  let emailSubject = toTrimmedString(options && options.emailSubject);
  let confirmationSubject = toTrimmedString(options && options.confirmationSubject);
  let buildNotificationText = options && typeof options.buildNotificationText === 'function'
    ? options.buildNotificationText
    : function () { return ''; };
  let buildNotificationHtml = options && typeof options.buildNotificationHtml === 'function'
    ? options.buildNotificationHtml
    : function () { return ''; };
  let buildConfirmationText = options && typeof options.buildConfirmationText === 'function'
    ? options.buildConfirmationText
    : function () { return ''; };
  let buildConfirmationHtml = options && typeof options.buildConfirmationHtml === 'function'
    ? options.buildConfirmationHtml
    : function () { return ''; };

  if (!orderRecord || !orderRecord._id) {
    return;
  }

  Promise.resolve().then(async function () {
    let notificationResult = null;
    let confirmationResult = null;

    if (!notificationEmail || !isLikelyEmailAddress(notificationEmail) || !emailSubject) {
      logger.warn('Order notification email skipped', {
        orderId: String(orderRecord._id),
      });
      await markOrderNotificationState(orderRecord._id, {
        status: 'email-failed',
        emailNotificationSent: false,
        customerConfirmationSent: false,
      });
      return;
    }

    notificationResult = await resendService.sendEmail({
      to: notificationEmail,
      subject: emailSubject,
      text: buildNotificationText(orderData),
      html: buildNotificationHtml(orderData),
    });

    if (!notificationResult.ok) {
      logger.error('Order notification email failed', {
        orderId: String(orderRecord._id),
        errorCode: notificationResult.errorCode,
      });
      await markOrderNotificationState(orderRecord._id, {
        status: 'email-failed',
        emailNotificationSent: false,
        customerConfirmationSent: false,
      });
      return;
    }

    await markOrderNotificationState(orderRecord._id, {
      status: 'submitted',
      emailNotificationSent: true,
      customerConfirmationSent: false,
    });

    if (!shouldSendCustomerConfirmation || !customerEmail || !isLikelyEmailAddress(customerEmail) || !confirmationSubject) {
      return;
    }

    confirmationResult = await resendService.sendEmail({
      to: customerEmail,
      subject: confirmationSubject,
      text: buildConfirmationText(orderData),
      html: buildConfirmationHtml(orderData),
    });

    if (!confirmationResult.ok) {
      logger.warn('Order customer confirmation email failed', {
        orderId: String(orderRecord._id),
        errorCode: confirmationResult.errorCode,
      });
      return;
    }

    await markOrderNotificationState(orderRecord._id, {
      customerConfirmationSent: true,
    });
  }).catch(function (error) {
    logger.error('Order notification queue failed', {
      orderId: String(orderRecord && orderRecord._id || ''),
      error: logger.serializeError(error),
    });
  });
}

async function countAcceptedSoldStock(productId) {
  let normalizedProductId = toTrimmedString(productId);
  let soldGroups = [];

  if (!normalizedProductId) {
    return 0;
  }

  try {
    await ensureDatabaseConnection();

    soldGroups = await Order.aggregate([
      {
        $match: {
          productId: normalizedProductId,
          adminStatus: 'accepted',
        },
      },
      {
        $group: {
          _id: null,
          sold: { $sum: '$quantity' },
        },
      },
    ]);

    if (!Array.isArray(soldGroups) || !soldGroups.length) {
      return 0;
    }

    return Number.isFinite(Number(soldGroups[0].sold)) ? Number(soldGroups[0].sold) : 0;
  } catch (error) {
    logger.error('Failed to count accepted sold stock', {
      productId: normalizedProductId,
      error: logger.serializeError(error),
    });
    return 0;
  }
}

async function listOrdersForUser(authenticatedUser) {
  let authUser = authenticatedUser && authenticatedUser.email ? authenticatedUser : null;
  let authenticatedUserId = toTrimmedString(authUser ? authUser.id : '');
  let authenticatedEmail = normalizeEmail(authUser ? authUser.email : '');
  let orderQueryClauses = [];
  let orderQuery = {};

  if (!authUser) {
    throw new AppError(401, 'auth-required', 'Authentication required');
  }

  await ensureDatabaseConnection();

  if (mongoose.isValidObjectId(authenticatedUserId)) {
    orderQueryClauses.push({ user: authenticatedUserId });
  }

  if (authenticatedUserId) {
    orderQueryClauses.push({ userId: authenticatedUserId });
  }

  if (authenticatedEmail) {
    orderQueryClauses.push({ customerEmail: authenticatedEmail });
  }

  if (orderQueryClauses.length > 1) {
    orderQuery = { $or: orderQueryClauses };
  } else if (orderQueryClauses.length === 1) {
    orderQuery = orderQueryClauses[0];
  }

  return Order.find(orderQuery)
    .select(customerOrderListSelectFields)
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
}

async function listAdminOrders(options) {
  let configOptions = options && typeof options === 'object' ? options : {};
  let requestedView = catalogService.normalizeForSearch(configOptions.view);
  let requestedPage = parsePositiveInteger(configOptions.page, 1);
  let requestedPageSize = parsePositiveInteger(configOptions.pageSize, adminOrderRequestsPageSize);
  let safePageSize = Math.max(1, Math.min(requestedPageSize, adminOrderRequestsLimit));
  let pendingFilter = { adminStatus: mongoose.trusted({ $in: ['pending', 'processing'] }) };
  let acceptedFilter = { adminStatus: 'accepted' };
  let counts = {
    total: 0,
    pending: 0,
    accepted: 0,
  };
  let resolvedView = 'pending';
  let selectedFilter = pendingFilter;
  let selectedCount = 0;
  let totalPages = 1;
  let page = 1;
  let skipCount = 0;
  let orders = [];

  await ensureDatabaseConnection();

  let countResults = await Promise.all([
    Order.countDocuments(pendingFilter),
    Order.countDocuments(acceptedFilter),
  ]);

  counts.pending = Number(countResults[0]) || 0;
  counts.accepted = Number(countResults[1]) || 0;
  counts.total = counts.pending + counts.accepted;

  if (requestedView === 'pending' || requestedView === 'accepted') {
    resolvedView = requestedView;
  } else if (!counts.pending && counts.accepted) {
    resolvedView = 'accepted';
  }

  selectedFilter = resolvedView === 'accepted' ? acceptedFilter : pendingFilter;
  selectedCount = resolvedView === 'accepted' ? counts.accepted : counts.pending;
  totalPages = Math.max(1, Math.ceil(selectedCount / safePageSize));
  page = Math.min(requestedPage, totalPages);
  skipCount = Math.max(0, (page - 1) * safePageSize);
  orders = await Order.find(selectedFilter)
    .select(adminOrderListSelectFields)
    .sort({ createdAt: -1 })
    .skip(skipCount)
    .limit(safePageSize)
    .lean();

  return {
    counts: counts,
    orders: orders,
    page: page,
    pageSize: safePageSize,
    totalPages: totalPages,
    view: resolvedView,
  };
}

async function createOrderRequest(payload) {
  let input = payload && typeof payload === 'object' ? payload : {};
  let authenticatedUser = input.authenticatedUser && input.authenticatedUser.email ? input.authenticatedUser : null;
  let authenticatedUserId = toTrimmedString(authenticatedUser ? authenticatedUser.id : '');
  let normalizedProductId = toTrimmedString(input.productId);
  let quantity = parsePositiveInteger(input.quantity, 0);
  let customerName = toTrimmedString(input.customerName);
  let phoneNumber = toTrimmedString(input.phoneNumber);
  let note = toTrimmedString(input.note);
  let customerEmail = normalizeEmail(authenticatedUser ? authenticatedUser.email : '');
  let productDoc = null;
  let productCategory = null;
  let productIdentifier = '';
  let productName = 'Product';
  let productType = 'Other';
  let availableStockQuantity = null;
  let unitPriceValue = 0;
  let unitPriceLabel = 'Contact for price';
  let totalPriceValue = 0;
  let totalLabel = 'Contact for price';
  let orderRecord = null;
  let orderData = null;
  let shouldSendCustomerConfirmation = false;

  if (!authenticatedUser) {
    throw new AppError(401, 'auth-required', 'Please login to place an order.');
  }

  await ensureDatabaseConnection();

  productDoc = await catalogService.findProductDocumentByIdentifier(normalizedProductId, { activeOnly: true });

  if (!productDoc) {
    throw new AppError(404, 'invalid-product', 'Product was not found.');
  }

  productCategory = productDoc && productDoc.category && typeof productDoc.category === 'object'
    ? productDoc.category
    : null;
  productIdentifier = toTrimmedString(productDoc.legacyId || productDoc._id);
  productName = toTrimmedString(productDoc.name) || productName;
  productType = toTrimmedString(productCategory && productCategory.name) || productType;
  availableStockQuantity = parseAvailableStockQuantity(productDoc.quantity);
  unitPriceValue = Number(productDoc.price);

  if (unitPriceValue > 0) {
    unitPriceLabel = 'NPR ' + catalogService.formatNprAmount(unitPriceValue);
    totalPriceValue = unitPriceValue * quantity;
    totalLabel = 'NPR ' + catalogService.formatNprAmount(totalPriceValue);
  }

  if (availableStockQuantity !== null) {
    if (availableStockQuantity < 1) {
      throw new AppError(400, 'out-of-stock', 'This product is currently out of stock.');
    }

    if (quantity > availableStockQuantity) {
      throw new AppError(400, 'insufficient-stock', 'Only ' + availableStockQuantity + ' item(s) are currently in stock.');
    }
  }

  orderRecord = await Order.create({
    user: mongoose.isValidObjectId(authenticatedUserId) ? authenticatedUserId : null,
    userId: authenticatedUserId || customerEmail,
    customerEmail: customerEmail,
    customerName: customerName,
    phoneNumber: phoneNumber,
    note: note,
    product: productDoc && productDoc._id ? productDoc._id : null,
    productId: productIdentifier,
    productName: productName,
    productType: productType,
    quantity: quantity,
    unitPriceLabel: unitPriceLabel,
    unitPriceValue: unitPriceValue > 0 ? unitPriceValue : 0,
    totalLabel: totalLabel,
    totalPriceValue: totalPriceValue > 0 ? totalPriceValue : 0,
    status: 'pending',
    emailNotificationSent: false,
    customerConfirmationSent: false,
  });

  orderData = {
    customerEmail: customerEmail,
    customerName: customerName,
    note: note,
    phoneNumber: phoneNumber,
    productName: productName,
    productType: productType,
    quantity: quantity,
    totalLabel: totalLabel,
    unitPriceLabel: unitPriceLabel,
  };

  shouldSendCustomerConfirmation = customerEmail && isLikelyEmailAddress(customerEmail);

  queueOrderNotificationEmails(orderRecord, orderData, {
    buildConfirmationHtml: input.buildConfirmationHtml,
    buildConfirmationText: input.buildConfirmationText,
    buildNotificationHtml: input.buildNotificationHtml,
    buildNotificationText: input.buildNotificationText,
    confirmationSubject: 'Order request received: ' + productName,
    customerEmail: customerEmail,
    emailSubject: 'New Order: ' + productName + ' x' + quantity,
    notificationEmail: config.store.orderNotificationEmail,
    shouldSendCustomerConfirmation: shouldSendCustomerConfirmation,
  });

  return {
    orderData: orderData,
    orderRecord: orderRecord,
  };
}

async function revertOrderToPending(orderId, adminMessage) {
  try {
    await Order.updateOne(
      { _id: orderId, adminStatus: 'processing' },
      {
        $set: {
          adminStatus: 'pending',
          adminMessage: adminMessage || '',
          adminAcceptedAt: null,
        },
      }
    );
  } catch (error) {
    logger.error('Failed to revert processing order', {
      orderId: toTrimmedString(orderId),
      error: logger.serializeError(error),
    });
  }
}

async function acceptOrderRequest(payload) {
  let input = payload && typeof payload === 'object' ? payload : {};
  let orderId = toTrimmedString(input.orderId);
  let adminMessage = toTrimmedString(input.adminMessage);
  let buildAcceptedEmailText = typeof input.buildAcceptedEmailText === 'function'
    ? input.buildAcceptedEmailText
    : function () { return ''; };
  let buildAcceptedEmailHtml = typeof input.buildAcceptedEmailHtml === 'function'
    ? input.buildAcceptedEmailHtml
    : function () { return ''; };
  let claimedOrder = null;
  let productDoc = null;
  let updatedProduct = null;
  let acceptedOrder = null;
  let orderQuantity = 1;
  let customerEmail = '';
  let emailSubject = '';
  let productName = '';

  await ensureDatabaseConnection();

  claimedOrder = await Order.findOneAndUpdate(
    { _id: orderId, adminStatus: 'pending' },
    {
      $set: {
        adminStatus: 'processing',
        adminMessage: adminMessage,
        adminAcceptedAt: null,
      },
    },
    { returnDocument: 'after' }
  );

  if (!claimedOrder) {
    claimedOrder = await Order.findById(orderId);

    if (!claimedOrder) {
      throw new AppError(404, 'order-not-found', 'Order not found');
    }

    if (catalogService.toTrimmedString(claimedOrder.adminStatus).toLowerCase() === 'accepted') {
      return {
        alreadyAccepted: true,
        order: claimedOrder,
      };
    }

    throw new AppError(409, 'save-failed', 'Order is already being processed');
  }

  orderQuantity = parsePositiveInteger(claimedOrder.quantity, 1);

  if (claimedOrder.product) {
    productDoc = await Product.findById(claimedOrder.product);
  }

  if (!productDoc && claimedOrder.productId) {
    productDoc = await Product.findOne({
      $or: [{ legacyId: claimedOrder.productId }].concat(
        mongoose.isValidObjectId(claimedOrder.productId) ? [{ _id: claimedOrder.productId }] : []
      ),
    });
  }

  try {
    if (productDoc) {
      updatedProduct = await Product.findOneAndUpdate(
        { _id: productDoc._id, quantity: mongoose.trusted({ $gte: orderQuantity }) },
        { $inc: { quantity: -orderQuantity } },
        { returnDocument: 'after' }
      );

      if (!updatedProduct) {
        await revertOrderToPending(orderId, adminMessage);

        if (Number(productDoc.quantity) < 1) {
          throw new AppError(400, 'out-of-stock', 'Product out of stock');
        }

        throw new AppError(400, 'insufficient-stock', 'Insufficient stock');
      }
    }

    acceptedOrder = await Order.findOneAndUpdate(
      { _id: orderId, adminStatus: 'processing' },
      {
        $set: {
          adminStatus: 'accepted',
          adminMessage: adminMessage,
          adminAcceptedAt: new Date(),
          adminEmailNotificationSent: false,
        },
      },
      { returnDocument: 'after' }
    );

    if (!acceptedOrder) {
      throw new Error('order-accept-update-failed');
    }
  } catch (error) {
    if (updatedProduct && updatedProduct._id && !acceptedOrder) {
      try {
        await Product.updateOne({ _id: updatedProduct._id }, { $inc: { quantity: orderQuantity } });
      } catch (restoreError) {
        logger.error('Failed to restore product stock after order accept failure', {
          orderId: orderId,
          error: logger.serializeError(restoreError),
        });
      }
    }

    if (errors.isAppError(error)) {
      throw error;
    }

    await revertOrderToPending(orderId, adminMessage);
    throw error;
  }

  catalogService.clearCatalogContextCache();

  customerEmail = normalizeEmail(acceptedOrder && acceptedOrder.customerEmail);
  productName = catalogService.toTrimmedString(acceptedOrder && acceptedOrder.productName) || 'Product';
  emailSubject = 'Order accepted: ' + productName;

  if (customerEmail && isLikelyEmailAddress(customerEmail) && acceptedOrder && acceptedOrder._id) {
    Promise.resolve().then(async function () {
      let sendResult = await resendService.sendEmail({
        to: customerEmail,
        subject: emailSubject,
        text: buildAcceptedEmailText(acceptedOrder, adminMessage),
        html: buildAcceptedEmailHtml(acceptedOrder, adminMessage),
      });

      if (!sendResult.ok) {
        logger.warn('Accepted-order email failed', {
          orderId: String(acceptedOrder._id),
          errorCode: sendResult.errorCode,
        });
        return;
      }

      await Order.updateOne(
        { _id: acceptedOrder._id },
        { $set: { adminEmailNotificationSent: true } }
      );
    }).catch(function (error) {
      logger.error('Accepted-order email queue failed', {
        orderId: String(acceptedOrder && acceptedOrder._id || ''),
        error: logger.serializeError(error),
      });
    });
  }

  return {
    alreadyAccepted: false,
    order: acceptedOrder,
  };
}

async function deleteOrder(orderId) {
  await ensureDatabaseConnection();

  return Order.findByIdAndDelete(orderId);
}
export default {
  acceptOrderRequest: acceptOrderRequest,
  countAcceptedSoldStock: countAcceptedSoldStock,
  createOrderRequest: createOrderRequest,
  deleteOrder: deleteOrder,
  listAdminOrders: listAdminOrders,
  listOrdersForUser: listOrdersForUser,
};

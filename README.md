# BhutanDevi Trade and Suppliers

BhutanDevi Trade and Suppliers is a **Node.js + Express catalog and admin management system** designed for managing and browsing motorcycle parts such as helmets, tyres, shocks, and accessories.

This project provides:

* Public storefront for customers
* Admin dashboard for catalog management
* Admin login protection for all `/admin` routes
* Server-side input validation for admin mutations
* Image upload system
* Automatic uploaded-image optimization (WebP conversion/compression)
* MongoDB primary storage
* Automatic JSON fallback storage
* Security headers and response compression middleware
* In-memory catalog context caching
* Server-rendered UI using EJS and Tailwind CSS

This README is written for both **developers and AI agents** to correctly understand and extend the system.

---

# Core Objectives

The system must provide:

1. Public catalog browsing
2. Admin catalog management
3. Reliable data persistence
4. Clean service-based architecture
5. Storage abstraction layer (MongoDB + JSON fallback)
6. Deterministic, normalized admin state

AI agents must preserve these architectural principles when modifying or extending the system.

---

# Tech Stack

Backend

* Node.js (18+)
* Express.js
* Mongoose (optional but primary persistence)

Frontend

* EJS templates
* Tailwind CSS

Storage

* MongoDB (primary)
* JSON file fallback

Uploads

* Multer

---

# Project Structure

```
.
├── app.js
├── bin/www
├── controllers/
│   ├── adminController.js
│   ├── authController.js
│   ├── catalogController.js
│   └── publicController.js
├── data/
│   └── admin-data.json
├── lib/
│   ├── adminAuth.js
│   ├── cloudinary.js
│   ├── db.js
│   ├── requestSanitizer.js
│   ├── userAuth.js
│   └── validation.js
├── models/
│   ├── AdminState.js
│   ├── Brand.js
│   ├── Category.js
│   ├── Order.js
│   ├── Product.js
│   ├── User.js
│   └── UserAuthCode.js
├── public/
│   ├── icons/
│   ├── images/
│   ├── javascripts/
│   ├── stylesheets/
│   ├── uploads/
│   │   └── products/
│   └── ...
├── repositories/
│   └── adminDataStore.js
├── routes/
│   ├── catalog.js
│   └── index.js
├── scripts/
│   └── migrate-catalog-admin-state.js
├── services/
│   ├── catalogCrudService.js
│   ├── catalogService.js
│   └── resendService.js
├── public/stylesheets/
│   ├── tailwind.css
│   └── style.css
└── views/
    ├── helpers/
    └── ...
```

---

# Architecture Overview

Layered architecture must be preserved:

```
Routes
  ↓
Controllers
  ↓
Services
  ↓
Persistence Layer
   ├── MongoDB
   └── JSON fallback
```

Rules:

* Controllers handle HTTP only
* Services contain business logic
* Services manage normalization
* Persistence layer handles storage only
* Controllers must NOT directly access database

AI agents must follow this structure.

---

# Admin State Schema (CRITICAL)

The entire admin state must always follow this exact normalized structure:

```
{
  categories: [],
  products: [],
  priceOverrides: {},
  imageOverrides: {},
  productOverrides: {},
  deletedProductIds: [],
  deletedCategoryNames: []
}
```

This schema must never be broken.

AI implementations must preserve this structure.

---

# Storage System

The system supports dual storage mode.

Priority order:

1. MongoDB (if MONGODB_URI is configured and reachable)
2. JSON fallback storage

MongoDB model key:

```
key: "catalog-admin-state"
```

Fallback file:

```
data/admin-data.json
```

Rules:

* MongoDB is primary source
* JSON is backup and fallback
* If MongoDB unavailable → use JSON
* Writes should update both when MongoDB is enabled

AI agents must not bypass this logic.

---

# Environment Configuration

Create `.env` file:

```
PORT=3000

MONGODB_URI=mongodb://127.0.0.1:27017/bhutandevitradeandsuppliers

# Admin authentication (enabled by default)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-this-password
ADMIN_SESSION_SECRET=change-this-secret

# Optional: disable admin auth in local development only
# ADMIN_AUTH_DISABLED=true

# Optional: cache TTL (ms) for catalog context
# CATALOG_CACHE_TTL_MS=15000

# Optional: WhatsApp number for product inquiry/order buttons
# STORE_WHATSAPP_NUMBER=9779800000000

# Customer auth (Gmail OTP via Resend)
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxx
RESEND_FROM_EMAIL=BhutanDevi <noreply@your-domain.com>
USER_SESSION_SECRET=change-this-user-session-secret
EMAIL_OTP_SECRET=change-this-otp-secret
```

MongoDB is optional.

Note: customer login/signup (Gmail OTP) requires MongoDB because users and OTP codes are stored in database.

---

# Installation

```
npm install
```

---

# Run Application

```
npm start
```

Access:

Public:

```
http://localhost:3000
```

Admin:

```
http://localhost:3000/admin
```

---

# Tailwind CSS

Build CSS:

```
npm run build:css
```

Watch mode:

```
npm run watch:css
```

---

# Image Upload System

Upload directory:

```
public/uploads/products/
```

Rules:

* images only
* max size 5MB
* relative path must be saved
* never store absolute path
* uploaded images are optimized to WebP using `sharp`

Example:

```
/uploads/products/helmet.jpg
```

---

# Public Routes

```
GET /
GET /home
GET /products/:productId
```

Must remain public and read-only.

---

# Admin Routes

```
GET /admin/login
POST /admin/login
POST /admin/logout

GET /admin

GET /admin/categories/:categorySlug

POST /admin/categories
POST /admin/categories/delete

POST /admin/products
POST /admin/products/edit
POST /admin/products/delete

POST /admin/prices
POST /admin/images
```

These routes modify admin state.

All modifications must go through catalogService.
All `/admin/*` routes (except login/logout) require authentication.

---

# Service Layer Rules (MANDATORY)

All catalog modifications must go through:

```
services/catalogService.js
```

Service responsibilities:

* normalize names
* prevent duplicates
* manage overrides
* manage deletions
* load state
* save state
* optimize uploaded images
* maintain short-lived in-memory catalog cache

Controllers must not implement business logic.

---

# Controller Rules (MANDATORY)

Controllers must:

* receive request
* validate request
* call service
* return response

Controllers must NOT:

* access database directly
* contain business logic

---

# MongoDB Model

Model:

```
models/AdminState.js
```

Structure:

```
{
  key: String,
  value: Object,
  updatedAt: Date
}
```

Only one document must exist:

```
key = "catalog-admin-state"
```

---

# AI Implementation Rules

AI agents modifying this project MUST:

1. Preserve layered architecture
2. Preserve admin state schema
3. Use service layer for business logic
4. Use persistence abstraction
5. Not introduce direct DB access in controllers
6. Maintain deterministic state structure
7. Maintain upload directory structure
8. Maintain backward compatibility

AI agents may extend system with:

* authentication
* caching
* validation
* optimization
* UI improvements

But must NOT break core architecture.

---

# Expected System Behavior

System must always guarantee:

* no data corruption
* no duplicate categories
* no duplicate products
* persistence reliability
* safe fallback when MongoDB unavailable

---

# Production Recommendations

Recommended improvements:

* Admin authentication
* Input validation
* Helmet security middleware
* Compression middleware
* MongoDB indexes
* Image optimization
* Caching

---

# Purpose of This README

This README defines the **source of truth for system architecture**.

Developers and AI agents must follow this specification when implementing features.

Breaking these rules may corrupt system state.

---

# System Status

Production-ready architecture
MongoDB supported
JSON fallback supported
Service-based design
AI-extendable structure

---

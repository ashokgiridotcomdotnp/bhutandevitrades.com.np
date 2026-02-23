var noImageProductPath = '/images/productParts/no-image.webp';

var baseCategoryGroups = [
  {
    name: 'Engine Oil',
    description: 'Top bike and scooter oil brands',
    items: [],
  },
  {
    name: 'Helmet',
    description: 'Safety helmets in all sizes',
    items: [],
  },
  {
    name: 'Chain Sprocket',
    description: 'Bike model specific sets',
    items: [],
  },
  {
    name: 'Grease',
    description: 'Wheel and bearing grease',
    items: [],
  },
  {
    name: 'Shock',
    description: 'Front and rear suspension parts',
    items: [],
  },
];

var baseProductSections = [];

var baseCategoryKeywordMap = {
  'engine oil': ['engine oil', 'oil'],
  tyres: ['tyre', 'tyres'],
  helmet: ['helmet', 'helmets'],
  'chain sprocket': ['chain sprocket', 'chain set', 'sprocket'],
  grease: ['grease'],
  shock: ['shock', 'suspension'],
};

var homeCarouselImages = [
  '/images/productParts/slidePasal.webp',
  '/images/productParts/slidePasal2.webp',
  '/images/productParts/slidePasal3.webp',
  '/images/productParts/helmet1.webp',
];

module.exports = {
  baseCategoryGroups: baseCategoryGroups,
  baseCategoryKeywordMap: baseCategoryKeywordMap,
  baseProductSections: baseProductSections,
  defaultProductImagePath: noImageProductPath,
  homeCarouselImages: homeCarouselImages,
  noImageProductPath: noImageProductPath,
};

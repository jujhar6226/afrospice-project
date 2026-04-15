import heroImage from "../../../assets/hero.png";

const productImages = import.meta.glob("../../../assets/products/*.{png,jpg,jpeg,webp,avif}", {
  eager: true,
  import: "default",
});

const PRODUCT_FILENAME_ALIASES = {
  "basmati rice 5kg": ["basmati-rice5kg.png", "basmati-rice-5kg.png"],
  "beef strips": ["beef-strips.png"],
  "bottled water 24pk": ["bottled water.png", "bottled-water-24pk.png"],
  "bread loaf": ["Bread Loaf.png", "bread-loaf.png"],
  "butter spread": ["butter-spread.png"],
  "cassava flour": ["cassava-flour.png"],
  "coke pack": ["coke-pack.png"],
  "cooking salt": ["cooking salt.png", "cooking-salt.png"],
  "egg tray": ["egg-tray.png"],
  "frozen chicken": ["frozen-chicken.png"],
  "groundnut mix": ["groundnut-mix.png"],
  "jollof rice mix": ["jollof-mix.png", "jollof-rice-mix.png"],
  "meat pie pack": ["meatpie-pack.png", "meat-pie-pack.png"],
  "milk powder": ["milk-powder.png"],
  "milo tin": ["milo-tin.png"],
  "orange juice": ["orange-juice.png"],
  "palm oil": ["palm-iol.png", "palm-oil.png"],
  "peanut butter": ["peanut-butter.png"],
  "plantain chips": ["plantain-chips.png"],
  "semolina flour": ["semolina-flour.png"],
  "sugar 2kg": ["sugar.png", "sugar-2kg.png"],
  "tomato paste": ["tomato-paste.png"],
};

const KEYWORD_TONES = [
  {
    match: ["water", "juice", "coke", "drink", "bottle"],
    tone: "fresh",
  },
  {
    match: ["bread", "pie", "bakery", "bag", "pack"],
    tone: "warm",
  },
  {
    match: ["butter", "milk", "egg", "dairy"],
    tone: "sun",
  },
  {
    match: ["rice", "flour", "salt", "powder", "oil", "spice", "paste", "mix", "sugar"],
    tone: "gold",
  },
];

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function findAssetByFilename(filename) {
  const normalizedTarget = normalizeText(filename);
  const entry = Object.entries(productImages).find(([path]) => {
    const normalizedPath = normalizeText(path).replace(/\\/g, "/");
    return normalizedPath.endsWith(`/${normalizedTarget}`);
  });

  return entry?.[1] || null;
}

function findProductImage(product = {}) {
  const candidateFilenames = PRODUCT_FILENAME_ALIASES[normalizeText(product?.name)] || [];
  for (const filename of candidateFilenames) {
    const image = findAssetByFilename(filename);
    if (image) {
      return image;
    }
  }

  return null;
}

function findTone(product = {}) {
  const searchText = [product?.name, product?.category, product?.supplier, product?.sku]
    .map(normalizeText)
    .join(" ");

  return (
    KEYWORD_TONES.find((rule) => rule.match.some((needle) => searchText.includes(needle)))?.tone ||
    "brand"
  );
}

export function getProductVisual(product = {}) {
  const image = findProductImage(product);
  const tone = findTone(product);

  return {
    image: image || heroImage,
    tone,
    alt: `${String(product?.name || "Product")} visual`,
  };
}

export default getProductVisual;

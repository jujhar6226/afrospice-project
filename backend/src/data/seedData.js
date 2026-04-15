const products = [
  { id: 1, name: "Jollof Rice Mix", sku: "SKU-FOOD-001", price: 12.99, stock: 98, category: "Food Staples", supplier: "Mama Gold Foods" },
  { id: 2, name: "Palm Oil", sku: "SKU-COOK-002", price: 9.5, stock: 79, category: "Cooking Essentials", supplier: "Rootline Mills" },
  { id: 3, name: "Basmati Rice 5kg", sku: "SKU-FOOD-003", price: 18.99, stock: 44, category: "Food Staples", supplier: "Golden Grain" },
  { id: 4, name: "Semolina Flour", sku: "SKU-FOOD-004", price: 7.25, stock: 61, category: "Food Staples", supplier: "Mill House" },
  { id: 5, name: "Cassava Flour", sku: "SKU-FOOD-005", price: 8.4, stock: 54, category: "Food Staples", supplier: "Mill House" },
  { id: 6, name: "Tomato Paste", sku: "SKU-GROC-006", price: 2.75, stock: 109, category: "Groceries", supplier: "Fresh Foods" },
  { id: 7, name: "Cooking Salt", sku: "SKU-GROC-007", price: 1.5, stock: 155, category: "Groceries", supplier: "Kitchen Essentials" },
  { id: 8, name: "Sugar 2kg", sku: "SKU-GROC-008", price: 5.99, stock: 68, category: "Groceries", supplier: "Sweet Supply" },
  { id: 9, name: "Peanut Butter", sku: "SKU-GROC-009", price: 5.85, stock: 35, category: "Groceries", supplier: "Nut Spread Co" },
  { id: 10, name: "Coke Pack", sku: "SKU-DRNK-010", price: 12, stock: 60, category: "Drinks", supplier: "Coca-Cola" },
  { id: 11, name: "Bottled Water 24pk", sku: "SKU-DRNK-011", price: 8.5, stock: 142, category: "Drinks", supplier: "Clear Spring" },
  { id: 12, name: "Orange Juice", sku: "SKU-DRNK-012", price: 6.99, stock: 39, category: "Drinks", supplier: "Pure Squeeze" },
  { id: 13, name: "Milo Tin", sku: "SKU-DRNK-013", price: 9.99, stock: 43, category: "Drinks", supplier: "Nestle" },
  { id: 14, name: "Milk Powder", sku: "SKU-DAIR-014", price: 14.25, stock: 28, category: "Dairy", supplier: "CreamLine" },
  { id: 15, name: "Butter Spread", sku: "SKU-DAIR-015", price: 7.25, stock: 24, category: "Dairy", supplier: "Farm Fresh" },
  { id: 16, name: "Egg Tray", sku: "SKU-DAIR-016", price: 11.75, stock: 29, category: "Dairy", supplier: "Happy Hen" },
  { id: 17, name: "Bread Loaf", sku: "SKU-BAKE-017", price: 2.99, stock: 72, category: "Bakery", supplier: "Sunrise Bakery" },
  { id: 18, name: "Meat Pie Pack", sku: "SKU-BAKE-018", price: 6.5, stock: 26, category: "Bakery", supplier: "Sunrise Bakery" },
  { id: 19, name: "Plantain Chips", sku: "SKU-SNCK-019", price: 4.25, stock: 64, category: "Snacks", supplier: "Crunch House" },
  { id: 20, name: "Groundnut Mix", sku: "SKU-SNCK-020", price: 3.5, stock: 48, category: "Snacks", supplier: "Crunch House" },
  { id: 21, name: "Frozen Chicken", sku: "SKU-MEAT-021", price: 18.5, stock: 31, category: "Meat & Protein", supplier: "Prime Farm" },
  { id: 22, name: "Beef Strips", sku: "SKU-MEAT-022", price: 15.75, stock: 22, category: "Meat & Protein", supplier: "Prime Farm" }
];

const users = [
  {
    id: 1,
    staffId: "ADMIN001",
    pin: "1234",
    fullName: "Store Owner",
    role: "Owner",
    department: "Management",
    email: "owner@afrospice.com",
    phone: "555-0001",
    status: "Active"
  },
  {
    id: 2,
    staffId: "AFR-001",
    pin: "1111",
    fullName: "Ama Mensah",
    role: "Manager",
    department: "Operations",
    email: "ama@afrospice.com",
    phone: "555-1001",
    status: "Active"
  },
  {
    id: 3,
    staffId: "AFR-002",
    pin: "2222",
    fullName: "Kojo Asare",
    role: "Cashier",
    department: "Sales",
    email: "kojo@afrospice.com",
    phone: "555-1002",
    status: "Active"
  },
  {
    id: 4,
    staffId: "AFR-003",
    pin: "3333",
    fullName: "Linda Boateng",
    role: "Inventory Clerk",
    department: "Inventory",
    email: "linda@afrospice.com",
    phone: "555-1003",
    status: "Active"
  }
];

const sales = [
  {
    id: "SALE-1001",
    subtotal: 138.37,
    tax: 10.38,
    total: 148.75,
    cashier: "Front Desk",
    customer: "Walk-in Customer",
    status: "Paid",
    channel: "In-Store",
    paymentMethod: "Card",
    date: "2026-03-18T10:00:00.000Z",
    items: [
      { id: 1, name: "Jollof Rice Mix", sku: "SKU-FOOD-001", qty: 4, price: 12.99 },
      { id: 10, name: "Coke Pack", sku: "SKU-DRNK-010", qty: 2, price: 12 },
      { id: 17, name: "Bread Loaf", sku: "SKU-BAKE-017", qty: 3, price: 2.99 },
      { id: 19, name: "Plantain Chips", sku: "SKU-SNCK-019", qty: 3, price: 4.25 },
      { id: 6, name: "Tomato Paste", sku: "SKU-GROC-006", qty: 17, price: 2.75 }
    ]
  },
  {
    id: "SALE-1002",
    subtotal: 86.0,
    tax: 6.4,
    total: 92.4,
    cashier: "Front Desk",
    customer: "Online Order",
    status: "Pending",
    channel: "Online",
    paymentMethod: "Transfer",
    date: "2026-03-18T13:15:00.000Z",
    items: [
      { id: 2, name: "Palm Oil", sku: "SKU-COOK-002", qty: 4, price: 9.5 },
      { id: 8, name: "Sugar 2kg", sku: "SKU-GROC-008", qty: 4, price: 5.99 },
      { id: 12, name: "Orange Juice", sku: "SKU-DRNK-012", qty: 2, price: 6.99 },
      { id: 18, name: "Meat Pie Pack", sku: "SKU-BAKE-018", qty: 2, price: 6.5 }
    ]
  },
  {
    id: "SALE-1003",
    subtotal: 204.74,
    tax: 15.36,
    total: 220.1,
    cashier: "Ama Mensah",
    customer: "Walk-in Customer",
    status: "Paid",
    channel: "In-Store",
    paymentMethod: "Cash",
    date: "2026-03-19T11:42:00.000Z",
    items: [
      { id: 3, name: "Basmati Rice 5kg", sku: "SKU-FOOD-003", qty: 4, price: 18.99 },
      { id: 14, name: "Milk Powder", sku: "SKU-DAIR-014", qty: 4, price: 14.25 },
      { id: 21, name: "Frozen Chicken", sku: "SKU-MEAT-021", qty: 4, price: 18.5 }
    ]
  }
];

module.exports = {
  products,
  users,
  sales,
};

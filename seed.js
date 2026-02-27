// seed.js
require('dotenv').config();
const mongoose = require('mongoose');
const products = require('./product.js');

// Define schema locally (independent of server.js)
const productSchema = new mongoose.Schema({
  id: Number,
  name: String,
  desc: String,
  price: Number,
  category: String,
  material: String,
  img: String
});

const Product = mongoose.model('Product', productSchema);

(async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB');

    // Clear existing products
    await Product.deleteMany({});
    console.log('🗑️  Cleared old products');

    // Insert new products
    await Product.insertMany(products);
    console.log(`✅ Inserted ${products.length} products`);

    process.exit();
  } catch (err) {
    console.error('❌ Error seeding database:', err);
    process.exit(1);
  }
})();

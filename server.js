// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
const Razorpay = require('razorpay');

// Initialize Razorpay instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,       // Add to .env
  key_secret: process.env.RAZORPAY_KEY_SECRET // Add to .env
});

const app = express();
const PORT = process.env.PORT || 5000;

// ---------- Mail Transporter ----------
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ---------- Middleware ----------
app.use(cors({
  origin: ['http://127.0.0.1:5500', 'http://localhost:5500'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// ---------- MongoDB connection ----------
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ---------- Models ----------
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String }
});
const User = mongoose.model('User', userSchema);

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

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  items: Array,
  total: Number,
  shipping: Object,
  paymentMethod: String,
  paymentId: String, // Added to store Razorpay payment ID
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

// ---------- Auth Middleware ----------
function authMiddleware(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ success: false, message: 'No token provided' });

  const token = auth.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Invalid token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
}

// ---------- Routes ----------
app.get('/health', (req, res) => {
  res.json({ success: true, message: 'Server is running' });
});

app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find();
    return res.json({ success: true, products: products || [] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error fetching products' });
  }
});

app.post('/api/signup', async (req, res) => {
  const { name, email, password, contact } = req.body; // <-- include contact
  if (!name || !email || !password || !contact) {
    return res.status(400).json({ success: false, message: 'All fields required' });
  }

  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashed, phone: contact }); // <-- save phone
    await user.save();

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Signup failed' });
  }
});


app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: 'All fields required' });

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ success: false, message: 'User not found' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// ---------- Razorpay order creation ----------
app.post('/api/razorpay/order', authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) return res.status(400).json({ success: false, message: 'Amount is required' });

    const options = {
      amount: amount, // in paise
      currency: "INR",
      receipt: `receipt_order_${Date.now()}`
    };

    const order = await razorpay.orders.create(options);
    res.json({ success: true, order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Razorpay order creation failed' });
  }
});

// ---------- Place order ----------
app.post('/api/orders', authMiddleware, async (req, res) => {
  const { items, total, shipping, paymentMethod, paymentId } = req.body;
  if (!items || !total || !shipping) {
    return res.status(400).json({ success: false, message: 'Missing order details' });
  }

  try {
    const order = new Order({
      user: req.userId,
      items,
      total,
      shipping,
      paymentMethod,
      paymentId: paymentId || null
    });
    await order.save();

    // Send confirmation email
    if (shipping.email) {
      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: shipping.email,
        subject: `Order Confirmation - Pearl Jewels`,
        html: `
          <div style="font-family:Arial,sans-serif;color:#333;">
            <h2>Thank you for your order, ${shipping.name}!</h2>
            <p>Your order <strong>#${order._id}</strong> has been received.</p>
            <h3>Order Summary:</h3>
            <ul>
              ${items.map(i => `<li>${i.name} - ₹${i.price} × ${i.qty}</li>`).join('')}
            </ul>
            <p><strong>Total:</strong> ₹${total.toLocaleString()}</p>
            <p><strong>Payment Method:</strong> ${paymentMethod}</p>
            <p>We’ll deliver your order soon to:</p>
            <p>${shipping.address}, ${shipping.city}, ${shipping.state} - ${shipping.pincode}</p>
            <br>
            <p style="color:#888;">– Pearl Jewels Team</p>
          </div>
        `
      };

      try {
        await transporter.sendMail(mailOptions);
        console.log(`📧 Confirmation email sent to ${shipping.email}`);
      } catch (mailErr) {
        console.error("❌ Failed to send confirmation email:", mailErr);
      }
    }

    res.json({ success: true, message: 'Order placed successfully', orderId: order._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Order failed' });
  }
});

app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('name email phone');
    if (!user)
      return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch user info' });
  }
});


// ---------- Serve frontend ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- Start server ----------
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

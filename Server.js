const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');
const moment = require('moment');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'dcs_secret_key_2025',
  resave: false,
  saveUninitialized: true
}));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Multer Configuration
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg', '.dwg', '.zip'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }
});

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI environment variable is not set.');
  console.error('Please set MONGODB_URI in your Render.com environment variables.');
  process.exit(1);
}

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ MongoDB connected | Admin user ready');
  initAdmin();
}).catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

// Mongoose Schemas & Models
const userSchema = new mongoose.Schema({
  full_name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, default: '123456' },
  role: { type: String, enum: ['admin', 'staff', 'contractor', 'viewer'], required: true },
  company: String,
  phone: String,
  profile_pic: { type: String, default: 'default.png' },
  created_at: { type: Date, default: Date.now }
});

const documentSchema = new mongoose.Schema({
  doc_number: { type: String, required: true, unique: true },
  type: { type: String, required: true },
  title: { type: String, required: true },
  rev: { type: String, default: 'A' },
  status: { type: String, default: 'Open' },
  discipline: String,
  area: String,
  contractor: String,
  submitted_by: String,
  issue_date: Date,
  due_date: Date,
  response_date: Date,
  days_open: { type: Number, default: 0 },
  remarks: String,
  attachments: [String],
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updated_at: { type: Date, default: Date.now }
});

const transmittalSchema = new mongoose.Schema({
  transmittal_no: { type: String, required: true, unique: true },
  title: String,
  issued_to: String,
  issued_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  documents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Document' }],
  remarks: String,
  status: { type: String, enum: ['Draft', 'Issued', 'Acknowledged'], default: 'Draft' },
  created_at: { type: Date, default: Date.now }
});

const revisionSchema = new mongoose.Schema({
  document_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  rev: { type: String, required: true },
  changed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  change_note: String,
  changed_at: { type: Date, default: Date.now }
});

const notificationSchema = new mongoose.Schema({
  message: String,
  type: { type: String, enum: ['all', 'admin', 'staff', 'contractor', 'viewer'] },
  created_at: { type: Date, default: Date.now }
});

const leaveSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: String,
  date: String,
  message: String,
  status: { type: String, default: 'Pending' },
  created_at: { type: Date, default: Date.now }
});

const feedbackSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  message: String,
  created_at: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Document = mongoose.model('Document', documentSchema);
const Transmittal = mongoose.model('Transmittal', transmittalSchema);
const Revision = mongoose.model('Revision', revisionSchema);
const Notification = mongoose.model('Notification', notificationSchema);
const Leave = mongoose.model('Leave', leaveSchema);
const Feedback = mongoose.model('Feedback', feedbackSchema);

// Helper Functions
function calcDaysOpen(issueDate, responseDate) {
  if (!issueDate) return 0;
  const start = moment(issueDate);
  const end = responseDate ? moment(responseDate) : moment();
  return end.diff(start, 'days');
}

async function generateDocNumber(type, discipline) {
  const count = await Document.countDocuments({ type, discipline });
  const padded = String(count + 1).padStart(3, '0');
  return `${type}-${discipline}-${padded}`;
}

async function generateTransmittalNumber() {
  const count = await Transmittal.countDocuments();
  const year = new Date().getFullYear();
  const padded = String(count + 1).padStart(3, '0');
  return `TRN-${year}-${padded}`;
}

async function initAdmin() {
  try {
    const adminExists = await User.findOne({ email: 'admin@dcs.com' });
    if (!adminExists) {
      await User.create({
        email: 'admin@dcs.com',
        password: 'admin123',
        role: 'admin',
        full_name: 'DCS Administrator'
      });
    }
  } catch (err) {
    console.error('Error initializing admin:', err);
  }
}

// Middleware
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.session.user.role)) {
      return res.redirect('/app?page=dashboard&msg=Access denied');
    }
    next();
  };
};

// Routes
app.get('/', (req, res) => res.redirect('/app'));

app.get('/login', (req, res) => {
  res.render('login', { error: req.query.error || null });
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (user) {
      req.session.user = {
        _id: user._id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        company: user.company
      };
      res.redirect('/app?page=dashboard');
    } else {
      res.redirect('/login?error=Invalid credentials');
    }
  } catch (err) {
    console.error('Login error:', err);
    res.redirect('/login?error=Database Error');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Import JSON Route
app.post('/import-json', requireAuth, requireRole('admin', 'staff'), async (req, res) => {
  try {
    const { data } = req.body;
    if (!Array.isArray(data)) {
      return res.json({ imported: 0, skipped: 0, errors: ['Invalid JSON format'] });
    }

    let imported = 0, skipped = 0, errors = [];

    for (const row of data) {
      try {
        if (!row.doc_number || !row.type) {
          skipped++;
          continue;
        }

        const days = calcDaysOpen(row.issue_date, row.response_date);
        await Document.updateOne(
          { doc_number: row.doc_number },
          {
            $setOnInsert: {
              type: row.type,
              title: row.title || '',
              rev: row.rev || 'A',
              status: row.status || 'Open',
              discipline: row.discipline,
              area: row.area,
              contractor: row.contractor,
              submitted_by: row.submitted_by,
              issue_date: row.issue_date,
              due_date: row.due_date,
              response_date: row.response_date,
              days_open: days,
              remarks: row.remarks,
              created_by: req.session.user._id
            }
          },
          { upsert: true }
        );
        imported++;
      } catch (err) {
        errors.push(err.message);
        skipped++;
      }
    }

    res.json({ imported, skipped, errors });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// File Upload Route
app.post('/upload-file', requireAuth, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({ filename: req.file.filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API Stats Route
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const total_documents = await Document.countDocuments();
    const total_transmittals = await Transmittal.countDocuments();
    const total_users = await User.countDocuments();

    const byStatus = {};
    const statuses = await Document.distinct('status');
    for (const status of statuses) {
      byStatus[status] = await Document.countDocuments({ status });
    }

    const byType = {};
    const types = await Document.distinct('type');
    for (const type of types) {
      byType[type] = await Document.countDocuments({ type });
    }

    const byDiscipline = {};
    const disciplines = await Document.distinct('discipline');
    for (const disc of disciplines) {
      byDiscipline[disc] = await Document.countDocuments({ discipline: disc });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdue = await Document.countDocuments({
      due_date: { $lt: today },
      status: { $nin: ['Approved', 'Closed'] }
    });

    res.json({
      total_documents,
      total_transmittals,
      total_users,
      by_status: byStatus,
      by_type: byType,
      by_discipline: byDiscipline,
      overdue_count: overdue
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Main App Handler
const appHandler = async (req, res) => {
  try {
    const page = req.query.page || 'dashboard';
    const user = req.session.user;
    const success_msg = req.query.msg || null;

    // Handle DELETE
    if (req.query.delete && req.query.table && req.query.id) {
      const { table, id } = req.query;
      try {
        if (table === 'documents') await Document.findByIdAndDelete(id);
        else if (table === 'transmittals') await Transmittal.findByIdAndDelete(id);
        else if (table === 'users' && id !== user._id.toString()) await User.findByIdAndDelete(id);
        else if (table === 'notifications') await Notification.findByIdAndDelete(id);
      } catch (err) {
        console.error('Delete error:', err);
      }
      return res.redirect(`/app?page=${req.query.page}&msg=Record deleted successfully.`);
    }

    // Handle POST Actions
    if (req.method === 'POST') {
      const action = req.body.action;
      let success_text = '';

      if (action === 'add_document') {
        let docNumber = req.body.doc_number;
        if (!docNumber) {
          docNumber = await generateDocNumber(req.body.type, req.body.discipline);
        }

        const daysOpen = calcDaysOpen(req.body.issue_date, req.body.response_date);

        const doc = await Document.create({
          doc_number: docNumber,
          type: req.body.type,
          title: req.body.title,
          rev: req.body.rev || 'A',
          status: req.body.status || 'Open',
          discipline: req.body.discipline,
          area: req.body.area,
          contractor: req.body.contractor,
          submitted_by: req.body.submitted_by,
          issue_date: req.body.issue_date,
          due_date: req.body.due_date,
          response_date: req.body.response_date,
          days_open: daysOpen,
          remarks: req.body.remarks,
          attachments: req.body.attachments ? req.body.attachments.split(',').filter(x => x) : [],
          created_by: user._id
        });

        await Revision.create({
          document_id: doc._id,
          rev: req.body.rev || 'A',
          changed_by: user._id,
          change_note: 'Initial submission'
        });

        success_text =*


const bcrypt = require("bcryptjs");
const Staff = require("../models/Staff");
const User = require("../models/User");
const StaffDepartment = require('../models/StaffDepartment');
const { logAction, redactSecrets } = require("../utils/auditLog");
const accountPhone = require('../utils/accountPhone');

const DETAIL_FIELDS = [
  "firstName", "middleName", "lastName", "dateOfBirth", "gender", "bloodGroup",
  "hasDisability", "disabilityType", "disabilityDocumentUrl", "phone", "emergencyContact",
  "countryCode", "landline", "emergencyContactName", "emergencyContactPhone",
  "presentAddress", "permanentAddress", "father", "mother", "spouse", "maritalStatus",
  "weddingDate", "nationality", "religion", "motherTongue", "panNumber", "bankName",
  "bankAccountNumber", "bankIfscCode", "iban", "branchAddress", "routingNumberOrAgentId",
  "about", "idProofType", "idProofDocumentUrl", "qualification", "yearsOfExperience",
  "previousOrganization", "previousDesignation", "educationProofDocumentUrl", "otherDocumentUrl",
  "employeeId", "staffType", "highestQualification", "designation", "employmentRole",
  "dateOfJoining", "employmentCountry", "employmentState", "workLocation", "natureOfEmployment",
  "attendanceCode", "transportAttendanceCode", "esiNumber", "epfNumber", "uan", "reportingTo",
  "rolesAndResponsibilities", "signatureDocumentUrl",
];

function detailValues(source) {
  return Object.fromEntries(
    DETAIL_FIELDS.filter((field) => source[field] !== undefined).map((field) => [field, source[field]])
  );
}

function cleanPermissions(permissions) {
  if (!Array.isArray(permissions)) return [];
  return permissions
    .map((p) => String(p).trim())
    .filter((p) => Staff.PERMISSION_KEYS.includes(p));
}

function serializeStaff(s) {
  return {
    id: s._id,
    name: s.name,
    firstName: s.firstName,
    middleName: s.middleName,
    lastName: s.lastName,
    dateOfBirth: s.dateOfBirth,
    gender: s.gender,
    bloodGroup: s.bloodGroup,
    hasDisability: s.hasDisability,
    disabilityType: s.disabilityType,
    disabilityDocumentUrl: s.disabilityDocumentUrl,
    phone: s.phone,
    emergencyContact: s.emergencyContact,
    idProofType: s.idProofType,
    idProofDocumentUrl: s.idProofDocumentUrl,
    qualification: s.qualification,
    yearsOfExperience: s.yearsOfExperience,
    previousOrganization: s.previousOrganization,
    previousDesignation: s.previousDesignation,
    educationProofDocumentUrl: s.educationProofDocumentUrl,
    otherDocumentUrl: s.otherDocumentUrl,
    ...detailValues(s),
    department: s.department,
    permissions: s.permissions || [],
    email: s.email,
    joinDate: s.joinDate,
    status: s.status,
    hasLogin: !!s.userId,
  };
}

// Include legacy free-text departments alongside the persisted catalogue.
async function listDepartments(req, res) {
  const values = await Promise.all([Staff.distinct('department'), StaffDepartment.distinct('name')]);
  const departments = [...new Map(values.flat().filter(Boolean).map(name => [name.trim().toLowerCase(), name.trim()])).values()];
  res.json({ departments: departments.filter(Boolean).sort((a, b) => a.localeCompare(b)) });
}

async function createDepartment(req, res) {
  const name = req.body.name;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) return res.status(400).json({ message: 'Enter a department name up to 100 characters' });
  const key = name.trim().toLowerCase();
  await StaffDepartment.init();
  let department;
  try {
    department = await StaffDepartment.findOneAndUpdate({ key }, { $setOnInsert: { name: name.trim() } }, { upsert: true, new: true, runValidators: true });
  } catch (e) { if (e.code !== 11000) throw e; department = await StaffDepartment.findOne({ key }); }
  res.status(201).json({ name: department.name });
}

async function list(req, res) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 10));
  const { search, includeInactive, status } = req.query;

  const filter = {};
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { department: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }
  if (status) {
    filter.status = status;
  } else if (!includeInactive) {
    filter.status = { $ne: "inactive" };
  }

  const [items, total] = await Promise.all([
    Staff.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Staff.countDocuments(filter),
  ]);

  res.json({
    items: items.map(serializeStaff),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

async function create(req, res) {
  const { firstName, middleName, lastName, department, email, phone, password, permissions } =
    req.body;
  const name = [firstName, middleName, lastName].filter(Boolean).join(" ").trim();
  if (typeof firstName !== 'string' || !firstName.trim() || !department || !email || !phone || !password) {
    return res.status(400).json({
      message: "first name, department, phone, email and password are required",
    });
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ message: 'Enter a valid email address' });
  const contactPhone = accountPhone.required(phone);
  // Validate profile fields before creating a login account.
  await new Staff({ ...detailValues(req.body), name, firstName, department, email, permissions: cleanPermissions(permissions) }).validate();

  const existing = await User.findOne({
    $or: [{ email: email.trim().toLowerCase() }, { phone: accountPhone.pattern(contactPhone) }],
  });
  if (existing) {
    return res.status(400).json({ message: "That email or phone number is already in use" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    name,
    email: email.trim().toLowerCase(),
    phone: contactPhone,
    passwordHash,
    role: "staff",
  });

  const staff = await Staff.create({
    name,
    firstName,
    middleName,
    lastName,
    dateOfBirth: req.body.dateOfBirth,
    gender: req.body.gender,
    bloodGroup: req.body.bloodGroup,
    hasDisability: req.body.hasDisability === true,
    disabilityType: req.body.hasDisability === true ? req.body.disabilityType : undefined,
    disabilityDocumentUrl:
      req.body.hasDisability === true ? req.body.disabilityDocumentUrl : undefined,
    phone: contactPhone,
    emergencyContact: req.body.emergencyContact,
    idProofType: req.body.idProofType,
    idProofDocumentUrl: req.body.idProofDocumentUrl,
    qualification: req.body.qualification,
    yearsOfExperience: req.body.yearsOfExperience,
    previousOrganization: req.body.previousOrganization,
    previousDesignation: req.body.previousDesignation,
    educationProofDocumentUrl: req.body.educationProofDocumentUrl,
    otherDocumentUrl: req.body.otherDocumentUrl,
    department,
    permissions: cleanPermissions(permissions),
    email: email.trim().toLowerCase(),
    userId: user._id,
    ...detailValues(req.body),
  });

  await logAction({
    req,
    entityType: "Staff",
    entityId: staff._id,
    action: "create",
    detail: redactSecrets(req.body),
  });
  await require('../services/mediaStorage').attach(req, 'staff', staff);
  res.status(201).json(serializeStaff(staff));
}

async function update(req, res) {
  const staff = await Staff.findById(req.params.id);
  if (!staff) {
    return res.status(404).json({ message: "Staff member not found" });
  }

  const { name, department, permissions, status, email } = req.body;
  if (name !== undefined) staff.name = name;
  if (department !== undefined) staff.department = department;
  if (permissions !== undefined) staff.permissions = cleanPermissions(permissions);
  if (status !== undefined) staff.status = status;
  if (email !== undefined) staff.email = email ? email.toLowerCase() : staff.email;
  Object.assign(staff, detailValues(req.body));
  if (req.body.hasDisability === false) {
    staff.disabilityType = undefined;
    staff.disabilityDocumentUrl = undefined;
  }
  if (req.body.firstName !== undefined || req.body.middleName !== undefined || req.body.lastName !== undefined) {
    staff.name = [staff.firstName, staff.middleName, staff.lastName].filter(Boolean).join(" ").trim();
  }
  await staff.save();
  await require('../services/mediaStorage').attach(req, 'staff', staff);

  if (req.body.password && staff.userId) {
    const passwordHash = await bcrypt.hash(req.body.password, 10);
    await User.findByIdAndUpdate(staff.userId, { passwordHash });
  }
  if (staff.userId && status !== undefined) {
    await User.findByIdAndUpdate(staff.userId, { active: status !== "inactive" });
  }
  if (staff.userId) {
    await User.findByIdAndUpdate(staff.userId, {
      name: staff.name,
      email: staff.email,
      phone: staff.phone,
    });
  }

  await logAction({
    req,
    entityType: "Staff",
    entityId: staff._id,
    action: "update",
    detail: redactSecrets(req.body),
  });
  res.json(serializeStaff(staff));
}

// "Delete" only disables the staff member (status: inactive) and blocks
// their portal login too. Nothing is ever hard-deleted.
async function disable(req, res) {
  const staff = await Staff.findByIdAndUpdate(
    req.params.id,
    { status: "inactive" },
    { new: true }
  );
  if (!staff) {
    return res.status(404).json({ message: "Staff member not found" });
  }
  if (staff.userId) {
    await User.findByIdAndUpdate(staff.userId, { active: false });
  }
  await logAction({ req, entityType: "Staff", entityId: staff._id, action: "disable" });
  res.json(serializeStaff(staff));
}

module.exports = { list, listDepartments, createDepartment, create, update, disable };

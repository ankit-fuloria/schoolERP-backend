const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true },
    line2: { type: String, trim: true },
    country: { type: String, trim: true },
    state: { type: String, trim: true },
    city: { type: String, trim: true },
    pincode: { type: String, trim: true },
  },
  { _id: false }
);

const parentDetailsSchema = new mongoose.Schema(
  {
    salutation: { type: String, trim: true },
    name: { type: String, trim: true },
    primaryPhone: { type: String, trim: true },
    secondaryPhone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    dateOfBirth: { type: Date },
    education: { type: String, trim: true },
    occupation: { type: String, trim: true },
    organization: { type: String, trim: true },
    designation: { type: String, trim: true },
    annualIncome: { type: Number, min: 0 },
    address: { type: addressSchema, default: () => ({}) },
    employeeOfInstitution: { type: Boolean, default: false },
    alumnusOfInstitution: { type: Boolean, default: false },
  },
  { _id: false }
);

const previousSchoolSchema = new mongoose.Schema(
  {
    schoolName: { type: String, trim: true },
    board: { type: String, trim: true },
    passedOutClass: { type: String, trim: true },
    percentageAchieved: { type: Number, min: 0, max: 100 },
    yearOfPassing: { type: Number, min: 1900, max: 3000 },
    reasonForWithdrawal: { type: String, trim: true },
  },
  { _id: false }
);

const studentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    admissionNo: { type: String, required: true, unique: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: "SchoolClass", required: true },
    paymentRevision: { type: Number, default: 0 },
    rollNo: { type: Number },
    gender: { type: String, enum: ["Male", "Female", "Other"] },
    dateOfBirth: { type: Date },
    bloodGroup: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
    },
    category: { type: String, enum: ["General", "SC", "ST", "OBC"], default: "General" },
    hasDisability: { type: Boolean, default: false },
    disabilityType: { type: String },
    disabilityDocumentUrl: { type: String },
    hasReservation: { type: Boolean, default: false },
    reservationType: { type: String },
    reservationDocumentUrls: [{ type: String }],
    address: { type: String },
    studentAddress: { type: addressSchema, default: () => ({}) },
    profileImageUrl: { type: String },
    fatherName: { type: String },
    fatherPhone: { type: String },
    motherName: { type: String },
    motherPhone: { type: String },
    fatherDetails: { type: parentDetailsSchema, default: () => ({}) },
    motherDetails: { type: parentDetailsSchema, default: () => ({}) },
    primaryContactRelation: {
      type: String,
      enum: ["father", "mother", "local_guardian", "legal_guardian"],
    },
    enquirySource: { type: String, trim: true },
    additionalInformation: { type: String, trim: true },
    remark: { type: String, trim: true },
    previousSchool: { type: previousSchoolSchema, default: () => ({}) },
    parentDashboardPhoneType: { type: String, enum: ["father", "mother"] },
    parentDashboardPhone: { type: String },
    emergencyContactName: { type: String },
    emergencyContactPhone: { type: String },
    // Government & Board Identification
    studentPan: { type: String, trim: true },
    delhiGovStudentId: { type: String, trim: true },
    cbseId: { type: String, trim: true },
    // Transport & Pickup
    modeOfTransport: { type: String, trim: true },
    bachaCollectorName: { type: String, trim: true },
    // Certificates & Documents
    birthCertificateUrl: { type: String, trim: true },
    birthCertificateName: { type: String, trim: true },
    transferCertificateUrl: { type: String, trim: true },
    transferCertificateName: { type: String, trim: true },
    previousReportCardUrl: { type: String, trim: true },
    previousReportCardName: { type: String, trim: true },
    siblingIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Student" }],
    admissionDate: { type: Date },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    attendancePercent: { type: Number, default: 0 },
    performancePercent: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = require("../tenancy/context").tenantModel("Student", studentSchema);

const mongoose = require("mongoose");
const SectionTransferRequest = require("../models/SectionTransferRequest");
const SchoolClass = require("../models/SchoolClass");
const Student = require("../models/Student");
const Teacher = require("../models/Teacher");
const User = require("../models/User");
const { logAction } = require("../utils/auditLog");

async function resolveTeacher(req) {
  let teacher = await Teacher.findOne({ userId: req.user.id });
  if (!teacher && req.user?.email) {
    teacher = await Teacher.findOne({ email: req.user.email.toLowerCase() });
    if (teacher && !teacher.userId) {
      teacher.userId = req.user.id;
      await teacher.save();
    }
  }
  return teacher;
}

function serializeRequest(item) {
  return {
    id: item._id,
    studentId: item.studentId?._id || item.studentId,
    studentName: item.studentId?.name || "Student",
    admissionNo: item.studentId?.admissionNo || "",
    rollNo: item.studentId?.rollNo ?? null,
    fromClassId: item.fromClassId?._id || item.fromClassId,
    fromClassName: item.fromClassId?.name || "",
    fromClassGrade: item.fromClassId?.grade || "",
    fromClassSection: item.fromClassId?.section || "",
    toClassId: item.toClassId?._id || item.toClassId,
    toClassName: item.toClassId?.name || "",
    toClassGrade: item.toClassId?.grade || "",
    toClassSection: item.toClassId?.section || "",
    requestedByTeacherId: item.requestedByTeacherId?._id || item.requestedByTeacherId,
    requestedByTeacherName: item.requestedByTeacherId?.name || "Class Teacher",
    targetTeacherId: item.targetTeacherId?._id || item.targetTeacherId || null,
    targetTeacherName: item.targetTeacherId?.name || (item.toClassId?.classTeacherId?.name ?? "Class Teacher"),
    reason: item.reason || "",
    status: item.status,
    actionBy: item.actionBy?._id || item.actionBy || null,
    actionByRole: item.actionByRole || null,
    actionByName: item.actionByName || null,
    actionNote: item.actionNote || "",
    actionAt: item.actionAt || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

async function createRequest(req, res) {
  const { studentId, toClassId, reason } = req.body;
  if (!studentId || !toClassId) {
    return res.status(400).json({ message: "studentId and toClassId are required" });
  }

  const student = await Student.findOne({ _id: studentId, status: { $ne: "inactive" } });
  if (!student) {
    return res.status(404).json({ message: "Active student not found" });
  }

  const fromClass = await SchoolClass.findById(student.classId);
  if (!fromClass) {
    return res.status(404).json({ message: "Student current class not found" });
  }

  const toClass = await SchoolClass.findOne({ _id: toClassId, status: { $ne: "inactive" } }).populate(
    "classTeacherId",
    "name"
  );
  if (!toClass) {
    return res.status(404).json({ message: "Target class not found" });
  }

  if (fromClass._id.toString() === toClass._id.toString()) {
    return res.status(400).json({ message: "Target class must be different from current class" });
  }

  let requestedByTeacher = null;
  if (req.user.role === "teacher") {
    requestedByTeacher = await resolveTeacher(req);
    if (!requestedByTeacher) {
      return res.status(403).json({ message: "No teacher profile linked to this user" });
    }

    const isClassTeacher =
      fromClass.classTeacherId &&
      fromClass.classTeacherId.toString() === requestedByTeacher._id.toString();

    if (!isClassTeacher) {
      return res.status(403).json({
        message: "Only the assigned class teacher can initiate a section transfer for their student",
      });
    }
  } else {
    // Principal / staff initiated
    if (fromClass.classTeacherId) {
      requestedByTeacher = await Teacher.findById(fromClass.classTeacherId);
    }
    if (!requestedByTeacher) {
      requestedByTeacher = await Teacher.findOne({ status: { $ne: "inactive" } });
    }
  }

  // Check existing pending request
  const existingPending = await SectionTransferRequest.findOne({
    studentId: student._id,
    status: "pending",
  });
  if (existingPending) {
    return res.status(400).json({
      message: "A section transfer request is already pending for this student",
    });
  }

  const targetTeacherId = toClass.classTeacherId?._id || toClass.classTeacherId || null;

  const request = await SectionTransferRequest.create({
    studentId: student._id,
    fromClassId: fromClass._id,
    toClassId: toClass._id,
    requestedByTeacherId: requestedByTeacher?._id || fromClass.classTeacherId,
    targetTeacherId,
    reason: (reason || "").trim(),
    status: "pending",
  });

  const populated = await SectionTransferRequest.findById(request._id)
    .populate("studentId", "name admissionNo rollNo")
    .populate("fromClassId", "name grade section")
    .populate("toClassId", "name grade section classTeacherId")
    .populate("requestedByTeacherId", "name")
    .populate("targetTeacherId", "name");

  await logAction({
    req,
    entityType: "Student",
    entityId: student._id,
    action: "update",
    detail: {
      fromClass: fromClass.name,
      toClass: toClass.name,
      requestId: request._id,
    },
    note: `Section transfer requested from ${fromClass.name} to ${toClass.name}`,
  });

  res.status(201).json({
    message: "Section transfer request submitted successfully",
    request: serializeRequest(populated),
  });
}

async function listRequests(req, res) {
  const { status, type } = req.query;
  const isPrincipalOrStaff = req.user.role === "principal" || req.user.role === "staff";

  const populateFields = [
    { path: "studentId", select: "name admissionNo rollNo" },
    { path: "fromClassId", select: "name grade section" },
    { path: "toClassId", select: "name grade section classTeacherId" },
    { path: "requestedByTeacherId", select: "name" },
    { path: "targetTeacherId", select: "name" },
  ];

  if (isPrincipalOrStaff) {
    const filter = {};
    if (status && ["pending", "approved", "rejected"].includes(status)) {
      filter.status = status;
    }
    const items = await SectionTransferRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate(populateFields);

    return res.json({
      requests: items.map(serializeRequest),
      pendingCount: items.filter((i) => i.status === "pending").length,
    });
  }

  // Teacher portal list
  const teacher = await resolveTeacher(req);
  if (!teacher) {
    return res.status(403).json({ message: "Teacher record not found" });
  }

  const myCTClasses = await SchoolClass.find({
    classTeacherId: teacher._id,
    status: { $ne: "inactive" },
  }).select("_id");
  const myCTClassIds = myCTClasses.map((c) => c._id.toString());

  const teacherFilter = {
    $or: [
      { requestedByTeacherId: teacher._id },
      { targetTeacherId: teacher._id },
      { fromClassId: { $in: myCTClassIds } },
      { toClassId: { $in: myCTClassIds } },
    ],
  };

  if (status && ["pending", "approved", "rejected"].includes(status)) {
    teacherFilter.status = status;
  }

  const items = await SectionTransferRequest.find(teacherFilter)
    .sort({ createdAt: -1 })
    .populate(populateFields);

  const incoming = [];
  const outgoing = [];

  items.forEach((item) => {
    const isTarget =
      (item.targetTeacherId?._id || item.targetTeacherId)?.toString() === teacher._id.toString() ||
      myCTClassIds.includes((item.toClassId?._id || item.toClassId)?.toString());

    if (isTarget) {
      incoming.push(serializeRequest(item));
    } else {
      outgoing.push(serializeRequest(item));
    }
  });

  const serializedAll = items.map(serializeRequest);

  if (type === "incoming") {
    return res.json({ requests: incoming, pendingCount: incoming.filter((i) => i.status === "pending").length });
  }
  if (type === "outgoing") {
    return res.json({ requests: outgoing, pendingCount: outgoing.filter((i) => i.status === "pending").length });
  }

  res.json({
    incoming,
    outgoing,
    requests: serializedAll,
    pendingIncomingCount: incoming.filter((i) => i.status === "pending").length,
    pendingCount: serializedAll.filter((i) => i.status === "pending").length,
  });
}

async function getAvailableClasses(req, res) {
  const { grade, currentClassId } = req.query;
  const filter = { status: { $ne: "inactive" } };
  if (grade) {
    filter.grade = grade;
  }
  if (currentClassId) {
    filter._id = { $ne: currentClassId };
  }

  const classes = await SchoolClass.find(filter)
    .populate("classTeacherId", "name email phone")
    .sort({ grade: 1, section: 1 });

  res.json({
    classes: classes.map((c) => ({
      id: c._id,
      name: c.name,
      grade: c.grade,
      section: c.section,
      studentCount: c.studentCount || 0,
      classTeacher: c.classTeacherId
        ? {
            id: c.classTeacherId._id,
            name: c.classTeacherId.name,
          }
        : null,
    })),
  });
}

async function approveRequest(req, res) {
  const { id } = req.params;
  const { note } = req.body;

  const request = await SectionTransferRequest.findById(id)
    .populate("studentId")
    .populate("fromClassId")
    .populate("toClassId");

  if (!request) {
    return res.status(404).json({ message: "Section transfer request not found" });
  }

  if (request.status !== "pending") {
    return res.status(400).json({ message: `Request is already ${request.status}` });
  }

  let approverName = req.user.name || "Administrator";
  const isPrincipalOrStaff = req.user.role === "principal" || req.user.role === "staff";

  if (!isPrincipalOrStaff) {
    const teacher = await resolveTeacher(req);
    if (!teacher) {
      return res.status(403).json({ message: "Teacher record not found" });
    }

    const isTargetTeacher =
      (request.targetTeacherId && request.targetTeacherId.toString() === teacher._id.toString()) ||
      (request.toClassId?.classTeacherId &&
        request.toClassId.classTeacherId.toString() === teacher._id.toString());

    if (!isTargetTeacher) {
      return res.status(403).json({
        message: "Only the target class teacher or principal can approve this transfer request",
      });
    }
    approverName = teacher.name;
  }

  // Execute student transfer
  const student = await Student.findById(request.studentId._id || request.studentId);
  if (!student) {
    return res.status(404).json({ message: "Student record not found" });
  }

  const fromClassId = request.fromClassId?._id || request.fromClassId;
  const toClassId = request.toClassId?._id || request.toClassId;

  student.classId = toClassId;
  await student.save();

  // Recalculate/synchronize student counts
  const [fromCount, toCount] = await Promise.all([
    Student.countDocuments({ classId: fromClassId, status: { $ne: "inactive" } }),
    Student.countDocuments({ classId: toClassId, status: { $ne: "inactive" } }),
  ]);

  await Promise.all([
    SchoolClass.updateOne({ _id: fromClassId }, { $set: { studentCount: fromCount } }),
    SchoolClass.updateOne({ _id: toClassId }, { $set: { studentCount: toCount } }),
  ]);

  request.status = "approved";
  request.actionBy = req.user.id;
  request.actionByRole = req.user.role;
  request.actionByName = approverName;
  request.actionNote = (note || "").trim();
  request.actionAt = new Date();
  await request.save();

  await logAction({
    req,
    entityType: "Student",
    entityId: student._id,
    action: "update",
    detail: {
      fromClassId,
      toClassId,
      requestId: request._id,
      approverRole: req.user.role,
      approverName,
    },
    note: `Section transfer approved for ${student.name} by ${approverName} (${req.user.role})`,
  });

  const populated = await SectionTransferRequest.findById(request._id)
    .populate("studentId", "name admissionNo rollNo")
    .populate("fromClassId", "name grade section")
    .populate("toClassId", "name grade section classTeacherId")
    .populate("requestedByTeacherId", "name")
    .populate("targetTeacherId", "name");

  res.json({
    message: "Section transfer approved and completed successfully",
    request: serializeRequest(populated),
  });
}

async function rejectRequest(req, res) {
  const { id } = req.params;
  const { reason } = req.body;

  const request = await SectionTransferRequest.findById(id)
    .populate("toClassId");

  if (!request) {
    return res.status(404).json({ message: "Section transfer request not found" });
  }

  if (request.status !== "pending") {
    return res.status(400).json({ message: `Request is already ${request.status}` });
  }

  let rejecterName = req.user.name || "Administrator";
  const isPrincipalOrStaff = req.user.role === "principal" || req.user.role === "staff";

  if (!isPrincipalOrStaff) {
    const teacher = await resolveTeacher(req);
    if (!teacher) {
      return res.status(403).json({ message: "Teacher record not found" });
    }

    const isTargetTeacher =
      (request.targetTeacherId && request.targetTeacherId.toString() === teacher._id.toString()) ||
      (request.toClassId?.classTeacherId &&
        request.toClassId.classTeacherId.toString() === teacher._id.toString());

    if (!isTargetTeacher) {
      return res.status(403).json({
        message: "Only the target class teacher or principal can reject this transfer request",
      });
    }
    rejecterName = teacher.name;
  }

  request.status = "rejected";
  request.actionBy = req.user.id;
  request.actionByRole = req.user.role;
  request.actionByName = rejecterName;
  request.actionNote = (reason || "").trim();
  request.actionAt = new Date();
  await request.save();

  await logAction({
    req,
    entityType: "SectionTransferRequest",
    entityId: request._id,
    action: "update",
    detail: {
      requestId: request._id,
      rejecterRole: req.user.role,
      rejecterName,
      reason,
    },
    note: `Section transfer rejected by ${rejecterName} (${req.user.role}): ${reason || "No reason specified"}`,
  });

  const populated = await SectionTransferRequest.findById(request._id)
    .populate("studentId", "name admissionNo rollNo")
    .populate("fromClassId", "name grade section")
    .populate("toClassId", "name grade section classTeacherId")
    .populate("requestedByTeacherId", "name")
    .populate("targetTeacherId", "name");

  res.json({
    message: "Section transfer request rejected",
    request: serializeRequest(populated),
  });
}

module.exports = {
  createRequest,
  listRequests,
  getAvailableClasses,
  approveRequest,
  rejectRequest,
};

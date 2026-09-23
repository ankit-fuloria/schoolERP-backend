const TimetableEntry = require("../models/TimetableEntry");
const SchoolSettings = require("../models/SchoolSettings");
const makeSimpleCrud = require("../utils/simpleCrud");
const { logAction } = require("../utils/auditLog");

const defaultPeriods = [
  { periodNo: 1, name: "Period 1", startTime: "09:30 AM", endTime: "10:20 AM", durationMinutes: 50, isBreak: false },
  { periodNo: 2, name: "Period 2", startTime: "10:20 AM", endTime: "11:10 AM", durationMinutes: 50, isBreak: false },
  { periodNo: 3, name: "Period 3", startTime: "11:10 AM", endTime: "12:00 PM", durationMinutes: 50, isBreak: false },
  { periodNo: 4, name: "Period 4", startTime: "12:00 PM", endTime: "12:50 PM", durationMinutes: 50, isBreak: false },
  { periodNo: 5, name: "Lunch Break", startTime: "12:50 PM", endTime: "01:40 PM", durationMinutes: 50, isBreak: true },
  { periodNo: 6, name: "Period 5", startTime: "01:40 PM", endTime: "02:20 PM", durationMinutes: 40, isBreak: false },
  { periodNo: 7, name: "Period 6", startTime: "02:20 PM", endTime: "03:10 PM", durationMinutes: 50, isBreak: false },
];

const defaultWorkingDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function getStructure(req, res) {
  let settings = await SchoolSettings.findOne();
  if (!settings) settings = await SchoolSettings.create({});
  if (!settings.lecturePeriods || settings.lecturePeriods.length === 0) {
    settings.lecturePeriods = defaultPeriods;
  }
  if (!settings.workingDays || settings.workingDays.length === 0) {
    settings.workingDays = defaultWorkingDays;
  }
  await settings.save();
  res.json({
    lecturePeriods: settings.lecturePeriods,
    workingDays: settings.workingDays,
  });
}

async function updateStructure(req, res) {
  let settings = await SchoolSettings.findOne();
  if (!settings) settings = await SchoolSettings.create({});
  const { lecturePeriods, workingDays } = req.body;
  if (Array.isArray(lecturePeriods)) {
    settings.lecturePeriods = lecturePeriods;
  }
  if (Array.isArray(workingDays)) {
    settings.workingDays = workingDays;
  }
  await settings.save();
  await logAction({
    req,
    entityType: "Timetable",
    entityId: settings._id,
    action: "update",
    note: "Updated timetable period structure and working days",
  });
  res.json({
    lecturePeriods: settings.lecturePeriods,
    workingDays: settings.workingDays,
  });
}

async function getGrid(req, res) {
  const { className, classId, teacherId, teacherName, session } = req.query;
  const filter = { status: { $ne: "inactive" } };

  if (classId) {
    filter.classId = classId;
  } else if (className) {
    filter.$or = [{ className }, { section: className }];
  }

  if (teacherId) {
    filter.teacherId = teacherId;
  } else if (teacherName) {
    filter.teacherName = teacherName;
  }

  if (session) filter.session = session;

  const entries = await TimetableEntry.find(filter).populate("classId teacherId");
  res.json({ entries });
}

async function bulkSaveGrid(req, res) {
  const { className, classId, teacherId, teacherName, session, entries } = req.body;
  if (!Array.isArray(entries)) {
    return res.status(400).json({ message: "Invalid entries array" });
  }

  const deleteFilter = {};
  if (classId) {
    deleteFilter.classId = classId;
  } else if (className) {
    deleteFilter.$or = [{ className }, { section: className }];
  } else if (teacherId) {
    deleteFilter.teacherId = teacherId;
  } else if (teacherName) {
    deleteFilter.teacherName = teacherName;
  }

  if (session) deleteFilter.session = session;

  if (Object.keys(deleteFilter).length > 0) {
    await TimetableEntry.deleteMany(deleteFilter);
  }

  // Remove teacher conflicts across other classes for the same day and period
  for (const entry of entries) {
    if (entry.day && entry.period && (entry.teacherId || entry.teacherName)) {
      const conflictFilter = {
        day: entry.day,
        period: entry.period,
        status: { $ne: "inactive" },
      };
      if (entry.teacherId) {
        conflictFilter.teacherId = entry.teacherId;
      } else {
        conflictFilter.teacherName = entry.teacherName;
      }
      await TimetableEntry.deleteMany(conflictFilter);
    }
  }

  const created = await TimetableEntry.insertMany(entries);
  await logAction({
    req,
    entityType: "Timetable",
    action: "update",
    detail: { count: created.length },
    note: `Saved ${created.length} timetable schedule entries`,
  });
  res.json({ message: "Timetable saved successfully", count: created.length });
}

const Subject = require("../models/Subject");
const Teacher = require("../models/Teacher");
const SchoolClass = require("../models/SchoolClass");

async function autoGenerateTimetable(req, res) {
  const { classId, session } = req.body;

  let settings = await SchoolSettings.findOne();
  if (!settings) settings = await SchoolSettings.create({});

  const workingDays =
    settings.workingDays && settings.workingDays.length > 0
      ? settings.workingDays
      : defaultWorkingDays;

  const activePeriods = (
    settings.lecturePeriods && settings.lecturePeriods.length > 0
      ? settings.lecturePeriods
      : defaultPeriods
  )
    .filter((p) => !p.isBreak)
    .sort((a, b) => a.periodNo - b.periodNo);

  let targetClasses = [];
  if (classId) {
    const cls = await SchoolClass.findById(classId);
    if (!cls) return res.status(404).json({ message: "Class not found" });
    targetClasses = [cls];
  } else {
    targetClasses = await SchoolClass.find({ status: "active" }).sort({ grade: 1, section: 1 });
  }

  if (targetClasses.length === 0) {
    return res.status(400).json({ message: "No active classes found for timetable generation" });
  }

  const allTeachers = await Teacher.find({ status: "active" });
  const allSubjects = await Subject.find({ status: "active" });

  const teacherBusyMap = new Set();
  const teacherLoadMap = new Map();
  // Maps `${tId}_${day}` -> Set of period numbers already taught today
  const teacherDayPeriodsMap = new Map();

  function assignTeacherToSlot(teacher, day, periodNo) {
    if (!teacher) return;
    const tId = teacher._id.toString();
    teacherBusyMap.add(`${tId}_${day}_${periodNo}`);
    teacherLoadMap.set(tId, (teacherLoadMap.get(tId) || 0) + 1);
    const dayKey = `${tId}_${day}`;
    if (!teacherDayPeriodsMap.has(dayKey)) {
      teacherDayPeriodsMap.set(dayKey, new Set());
    }
    teacherDayPeriodsMap.get(dayKey).add(Number(periodNo));
  }

  function unassignTeacherFromSlot(teacher, day, periodNo) {
    if (!teacher) return;
    const tId = teacher._id.toString();
    teacherBusyMap.delete(`${tId}_${day}_${periodNo}`);
    teacherLoadMap.set(tId, Math.max(0, (teacherLoadMap.get(tId) || 1) - 1));
    const dayKey = `${tId}_${day}`;
    if (teacherDayPeriodsMap.has(dayKey)) {
      teacherDayPeriodsMap.get(dayKey).delete(Number(periodNo));
    }
  }

  // If single class mode, track existing schedules of other classes
  if (classId) {
    const existingEntries = await TimetableEntry.find({ classId: { $ne: classId } });
    for (const e of existingEntries) {
      if (e.teacherId && e.day && e.period) {
        const tId = e.teacherId.toString();
        teacherBusyMap.add(`${tId}_${e.day}_${e.period}`);
        teacherLoadMap.set(tId, (teacherLoadMap.get(tId) || 0) + 1);
        const dayKey = `${tId}_${e.day}`;
        if (!teacherDayPeriodsMap.has(dayKey)) {
          teacherDayPeriodsMap.set(dayKey, new Set());
        }
        teacherDayPeriodsMap.get(dayKey).add(Number(e.period));
      }
    }
  }

  function isTeacherMappedToClass(t, cls) {
    const classIdStr = cls._id.toString();
    const classNameStr = (cls.name || "").toString().trim().toLowerCase();

    // 1. Explicit assignments array
    const hasAssignment = (t.assignments || []).some((a) => {
      const aCid = (a.classId?._id || a.classId)?.toString();
      const aCname = (a.className || "").toString().trim().toLowerCase();
      return aCid === classIdStr || (aCname && aCname === classNameStr);
    });
    if (hasAssignment) return true;

    // 2. Class teacher
    if (cls.classTeacherId && (cls.classTeacherId._id || cls.classTeacherId).toString() === t._id.toString()) {
      return true;
    }

    // 3. Single class assigned field
    if (t.classAssigned) {
      const assignedLower = t.classAssigned.toString().trim().toLowerCase();
      if (assignedLower === classNameStr || t.classAssigned.toString() === classIdStr) {
        return true;
      }
    }

    return false;
  }

  // Evaluates candidate teachers using both load and Teacher Schedule Compactness (TSC).
  // Favors contiguous teaching blocks and penalizes fragmented idle gaps (e.g. 3+ period holes).
  function getBestTeacher(candidates, day, periodNo) {
    let best = null;
    let bestScore = Infinity;
    const pNum = Number(periodNo);

    for (const t of candidates) {
      const tId = t._id.toString();
      const busyKey = `${tId}_${day}_${periodNo}`;
      if (!teacherBusyMap.has(busyKey)) {
        const load = teacherLoadMap.get(tId) || 0;
        const dayKey = `${tId}_${day}`;
        const dayPeriods = teacherDayPeriodsMap.get(dayKey);

        let contiguityBonus = 0;
        let gapPenalty = 0;

        if (dayPeriods && dayPeriods.size > 0) {
          // Contiguity: Does the teacher already teach period - 1 or period + 1?
          if (dayPeriods.has(pNum - 1) || dayPeriods.has(pNum + 1)) {
            contiguityBonus = 2.5; // strong reward for consecutive period
          }

          // Gap penalty: distance to closest existing lecture today
          let minDistance = Infinity;
          for (const existingP of dayPeriods) {
            const dist = Math.abs(existingP - pNum);
            if (dist < minDistance) minDistance = dist;
          }

          // A 1 or 2 period distance is standard (recess/free period), but >= 3 creates an unproductive idle gap
          if (minDistance >= 3) {
            gapPenalty = 2.0;
          }
        }

        // Composite penalty score: lower is better
        const compositeScore = (load * 1.5) + gapPenalty - contiguityBonus;
        if (compositeScore < bestScore) {
          bestScore = compositeScore;
          best = t;
        }
      }
    }
    return best;
  }

  // Cognitive load tiers:
  // Tier 1 (High analytical/mental effort): Math, Physics, Chemistry, Science, Biology, Accountancy -> Morning periods (1-4)
  // Tier 3 (Creative/physical/co-curricular): Art, Music, PE, Sports, Library, Dance, Yoga, Craft -> Afternoon periods (5+)
  // Tier 2 (Core/social/language): English, Hindi, Social Science, History, etc. -> Balanced
  function getCognitiveTier(subj) {
    const text = ((subj?.name || "") + " " + (subj?.code || "")).toLowerCase();
    if (/\b(math|mathematics|sci|science|physic|physics|chem|chemistry|bio|biology|account|accounts)\b/i.test(text)) {
      return 1;
    }
    if (/\b(art|drawing|music|pe|physical|sport|sports|library|dance|craft|yoga|game|games)\b/i.test(text)) {
      return 3;
    }
    return 2;
  }

  function getSortedPeriodsForSubject(subj, periods) {
    const tier = getCognitiveTier(subj);
    if (tier === 1) {
      // Prioritize morning focus periods (1, 2, 3, 4...)
      return [...periods].sort((a, b) => a.periodNo - b.periodNo);
    } else if (tier === 3) {
      // Prioritize afternoon/later periods
      return [...periods].sort((a, b) => b.periodNo - a.periodNo);
    }
    return periods;
  }

  function getCandidateTeachers(subj, classIdStr, cls, classTeachers) {
    const sName = (subj.name || "").toLowerCase().trim();
    const sCode = (subj.code || "").toLowerCase().trim();

    function matchesSubject(subStr) {
      if (!subStr) return false;
      const tSub = subStr.toLowerCase().trim();
      if (tSub === sName || tSub === sCode) return true;
      if (sName && (sName === tSub || sName.includes(tSub) || tSub.includes(sName))) return true;
      if (sCode && (sCode === tSub || sCode.includes(tSub) || tSub.includes(sCode))) return true;
      return false;
    }

    // 1. Explicit class+subject assignment among mapped teachers
    let candidates = classTeachers.filter((t) =>
      (t.assignments || []).some((a) => {
        const aCid = (a.classId?._id || a.classId)?.toString();
        const aCname = (a.className || "").toString().trim().toLowerCase();
        return (aCid === classIdStr || (aCname && aCname === cls.name.toLowerCase())) &&
          matchesSubject(a.subject);
      })
    );
    if (candidates.length > 0) return candidates;

    // 2. Primary subject match among mapped teachers
    candidates = classTeachers.filter((t) => matchesSubject(t.subject));
    if (candidates.length > 0) return candidates;

    // Strict: Do not assign teachers of other subjects
    return [];
  }

  const generatedEntries = [];
  const warnings = [];

  for (const cls of targetClasses) {
    const grade = cls.grade;
    const classIdStr = cls._id.toString();

    const classSubjects = allSubjects.filter((s) => {
      const hasClassId = s.classIds && s.classIds.some((id) => (id._id || id).toString() === classIdStr);
      const hasCurriculum = (s.curriculum || []).some((cu) => cu.grade === grade);
      const hasWeekly = (s.weeklyLectures || []).some((w) => w.grade === grade);
      return hasClassId || hasCurriculum || hasWeekly;
    });

    if (classSubjects.length === 0) {
      warnings.push(`Class ${cls.name} has no assigned subjects`);
      continue;
    }

    const classTeachers = allTeachers.filter((t) => isTeacherMappedToClass(t, cls));
    if (classTeachers.length === 0) {
      warnings.push(`Class ${cls.name} has no teachers mapped to it. No teachers will be assigned.`);
    }

    const subjectRequirements = classSubjects.map((subj) => {
      const gConfig = (subj.weeklyLectures || []).find((w) => w.grade === grade);
      const lecturesPerWeek = gConfig?.lecturesPerWeek ?? 5;
      const preferredPeriod = gConfig?.preferredPeriod;
      const candidates = getCandidateTeachers(subj, classIdStr, cls, classTeachers);

      return {
        subject: subj,
        candidates,
        lecturesPerWeek,
        preferredPeriod,
        allocatedCount: 0,
      };
    });

    subjectRequirements.sort((a, b) => {
      if (a.preferredPeriod && !b.preferredPeriod) return -1;
      if (!a.preferredPeriod && b.preferredPeriod) return 1;
      return b.lecturesPerWeek - a.lecturesPerWeek;
    });

    const classGrid = new Map();
    const dailySubjectCount = new Map();

    function isSameSubject(subjA, subjB) {
      if (!subjA || !subjB) return false;
      const nameA = (subjA.name || subjA).toString().trim().toLowerCase();
      const nameB = (subjB.name || subjB).toString().trim().toLowerCase();
      if (nameA === nameB) return true;
      const codeA = (subjA.code || "").toString().trim().toLowerCase();
      const codeB = (subjB.code || "").toString().trim().toLowerCase();
      if (codeA && codeB && codeA === codeB) return true;
      if (codeA && (codeA === nameB || nameB.includes(codeA))) return true;
      if (codeB && (codeB === nameA || nameA.includes(codeB))) return true;
      return false;
    }

    function wouldBeSequential(day, periodNo, targetSubject) {
      const pIdx = activePeriods.findIndex((p) => p.periodNo === periodNo);
      if (pIdx === -1) return false;

      // Check immediately preceding active period on this day
      if (pIdx > 0) {
        const prevP = activePeriods[pIdx - 1];
        const prevEntry = classGrid.get(`${day}_${prevP.periodNo}`);
        if (prevEntry && isSameSubject(prevEntry.reqObj?.subject, targetSubject)) {
          return true;
        }
      }

      // Check immediately succeeding active period on this day
      if (pIdx < activePeriods.length - 1) {
        const nextP = activePeriods[pIdx + 1];
        const nextEntry = classGrid.get(`${day}_${nextP.periodNo}`);
        if (nextEntry && isSameSubject(nextEntry.reqObj?.subject, targetSubject)) {
          return true;
        }
      }

      return false;
    }

    // Pass 1: Preferred periods
    for (const reqObj of subjectRequirements) {
      if (!reqObj.preferredPeriod) continue;
      const targetPeriod = activePeriods.find((p) => p.periodNo === reqObj.preferredPeriod);
      if (!targetPeriod) continue;

      for (const day of workingDays) {
        if (reqObj.allocatedCount >= reqObj.lecturesPerWeek) break;
        const gridKey = `${day}_${targetPeriod.periodNo}`;
        if (classGrid.has(gridKey)) continue;
        if (wouldBeSequential(day, targetPeriod.periodNo, reqObj.subject)) continue;

        const bestTeacher = getBestTeacher(reqObj.candidates, day, targetPeriod.periodNo);
        if (bestTeacher) {
          classGrid.set(gridKey, { reqObj, teacher: bestTeacher, period: targetPeriod, day });
          reqObj.allocatedCount++;
          assignTeacherToSlot(bestTeacher, day, targetPeriod.periodNo);
          dailySubjectCount.set(
            `${day}_${reqObj.subject.name}`,
            (dailySubjectCount.get(`${day}_${reqObj.subject.name}`) || 0) + 1
          );
        }
      }
    }

    // Pass 2: Balanced distribution (max 1 per day constraint, strictly non-sequential, cognitive morning-focus)
    for (const reqObj of subjectRequirements) {
      const maxPerDay = Math.ceil(reqObj.lecturesPerWeek / workingDays.length);
      const prioritizedPeriods = getSortedPeriodsForSubject(reqObj.subject, activePeriods);

      while (reqObj.allocatedCount < reqObj.lecturesPerWeek) {
        let placed = false;
        for (const day of workingDays) {
          const currentDaily = dailySubjectCount.get(`${day}_${reqObj.subject.name}`) || 0;
          if (currentDaily >= maxPerDay) continue;

          for (const period of prioritizedPeriods) {
            const gridKey = `${day}_${period.periodNo}`;
            if (classGrid.has(gridKey)) continue;
            if (wouldBeSequential(day, period.periodNo, reqObj.subject)) continue;

            const bestTeacher = getBestTeacher(reqObj.candidates, day, period.periodNo);
            if (bestTeacher) {
              classGrid.set(gridKey, { reqObj, teacher: bestTeacher, period, day });
              reqObj.allocatedCount++;
              assignTeacherToSlot(bestTeacher, day, period.periodNo);
              dailySubjectCount.set(`${day}_${reqObj.subject.name}`, currentDaily + 1);
              placed = true;
              break;
            }
          }
          if (placed) break;
        }

        if (!placed) break;
      }
    }

    // Pass 3: Relaxed distribution (max 2 per day) & cognitive period order (strictly non-sequential)
    for (const reqObj of subjectRequirements) {
      const prioritizedPeriods = getSortedPeriodsForSubject(reqObj.subject, activePeriods);

      while (reqObj.allocatedCount < reqObj.lecturesPerWeek) {
        let placed = false;
        for (const day of workingDays) {
          const currentDaily = dailySubjectCount.get(`${day}_${reqObj.subject.name}`) || 0;
          if (currentDaily >= 2) continue;

          for (const period of prioritizedPeriods) {
            const gridKey = `${day}_${period.periodNo}`;
            if (classGrid.has(gridKey)) continue;
            if (wouldBeSequential(day, period.periodNo, reqObj.subject)) continue;

            let bestTeacher = getBestTeacher(reqObj.candidates, day, period.periodNo);

            if (bestTeacher) {
              classGrid.set(gridKey, { reqObj, teacher: bestTeacher, period, day });
              reqObj.allocatedCount++;
              assignTeacherToSlot(bestTeacher, day, period.periodNo);
              dailySubjectCount.set(`${day}_${reqObj.subject.name}`, currentDaily + 1);
              placed = true;
              break;
            }
          }
          if (placed) break;
        }

        if (!placed) break;
      }
    }

    // Pass 3.5: Min-Conflicts Swap Resolution (2-opt Local Search)
    // If a subject still has unallocated lectures due to teacher contention,
    // swap an existing assigned period in this class to an empty slot where both teachers are free.
    for (const reqObj of subjectRequirements) {
      if (reqObj.allocatedCount >= reqObj.lecturesPerWeek) continue;
      if (!reqObj.candidates || reqObj.candidates.length === 0) continue;

      while (reqObj.allocatedCount < reqObj.lecturesPerWeek) {
        let swapped = false;

        for (const day of workingDays) {
          const currentDaily = dailySubjectCount.get(`${day}_${reqObj.subject.name}`) || 0;
          if (currentDaily >= 2) continue;

          for (const period of activePeriods) {
            const gridKey = `${day}_${period.periodNo}`;
            if (classGrid.has(gridKey)) continue; // target slot must be empty for this class
            if (wouldBeSequential(day, period.periodNo, reqObj.subject)) continue;

            // Direct candidate check first
            const directTeacher = getBestTeacher(reqObj.candidates, day, period.periodNo);
            if (directTeacher) {
              classGrid.set(gridKey, { reqObj, teacher: directTeacher, period, day });
              reqObj.allocatedCount++;
              assignTeacherToSlot(directTeacher, day, period.periodNo);
              dailySubjectCount.set(`${day}_${reqObj.subject.name}`, currentDaily + 1);
              swapped = true;
              break;
            }

            // If no candidate is directly free at `period`, check if swapping another period frees a candidate
            for (const otherPeriod of activePeriods) {
              if (otherPeriod.periodNo === period.periodNo) continue;
              const otherKey = `${day}_${otherPeriod.periodNo}`;
              const existingEntry = classGrid.get(otherKey);
              if (!existingEntry || !existingEntry.teacher) continue;

              // Check if a candidate for reqObj is free at otherPeriod
              const swapCandidate = getBestTeacher(reqObj.candidates, day, otherPeriod.periodNo);
              if (!swapCandidate) continue;

              // Check if existingEntry's teacher is free at target period
              const existingTeacherId = existingEntry.teacher._id.toString();
              const targetBusyKey = `${existingTeacherId}_${day}_${period.periodNo}`;
              if (teacherBusyMap.has(targetBusyKey)) continue;

              // Temporarily unassign existingEntry to test sequential constraints
              classGrid.delete(otherKey);
              unassignTeacherFromSlot(existingEntry.teacher, day, otherPeriod.periodNo);

              const canMoveExisting = !wouldBeSequential(day, period.periodNo, existingEntry.reqObj.subject);
              const canPlaceNew = !wouldBeSequential(day, otherPeriod.periodNo, reqObj.subject);

              if (canMoveExisting && canPlaceNew) {
                // Execute 2-opt swap:
                // 1. Move existingEntry to `period`
                classGrid.set(gridKey, {
                  reqObj: existingEntry.reqObj,
                  teacher: existingEntry.teacher,
                  period,
                  day,
                });
                assignTeacherToSlot(existingEntry.teacher, day, period.periodNo);

                // 2. Place reqObj at `otherPeriod` with swapCandidate
                classGrid.set(otherKey, {
                  reqObj,
                  teacher: swapCandidate,
                  period: otherPeriod,
                  day,
                });
                assignTeacherToSlot(swapCandidate, day, otherPeriod.periodNo);

                reqObj.allocatedCount++;
                dailySubjectCount.set(`${day}_${reqObj.subject.name}`, currentDaily + 1);
                swapped = true;
                break;
              } else {
                // Rollback if constraint violated
                classGrid.set(otherKey, existingEntry);
                assignTeacherToSlot(existingEntry.teacher, day, otherPeriod.periodNo);
              }
            }
            if (swapped) break;
          }
          if (swapped) break;
        }

        if (!swapped) break;
      }
    }

    // Pass 4A: Place any remaining unallocated lectures on empty slots without a teacher
    // Balanced distribution (max 1 per day), strictly NEVER in consecutive periods
    for (const reqObj of subjectRequirements) {
      const maxPerDay = Math.ceil(reqObj.lecturesPerWeek / workingDays.length);
      while (reqObj.allocatedCount < reqObj.lecturesPerWeek) {
        let placed = false;
        for (const day of workingDays) {
          const currentDaily = dailySubjectCount.get(`${day}_${reqObj.subject.name}`) || 0;
          if (currentDaily >= maxPerDay) continue;

          for (const period of activePeriods) {
            const gridKey = `${day}_${period.periodNo}`;
            if (classGrid.has(gridKey)) continue;
            if (wouldBeSequential(day, period.periodNo, reqObj.subject)) continue;

            classGrid.set(gridKey, { reqObj, teacher: null, period, day });
            reqObj.allocatedCount++;
            dailySubjectCount.set(`${day}_${reqObj.subject.name}`, currentDaily + 1);
            placed = true;
            break;
          }
          if (placed) break;
        }
        if (!placed) break;
      }
    }

    // Pass 4B: If still unallocated (e.g. lecturesPerWeek > workingDays), allow max 2 per day, NEVER sequential
    for (const reqObj of subjectRequirements) {
      while (reqObj.allocatedCount < reqObj.lecturesPerWeek) {
        let placed = false;
        for (const day of workingDays) {
          const currentDaily = dailySubjectCount.get(`${day}_${reqObj.subject.name}`) || 0;
          if (currentDaily >= 2) continue;

          for (const period of activePeriods) {
            const gridKey = `${day}_${period.periodNo}`;
            if (classGrid.has(gridKey)) continue;
            if (wouldBeSequential(day, period.periodNo, reqObj.subject)) continue;

            classGrid.set(gridKey, { reqObj, teacher: null, period, day });
            reqObj.allocatedCount++;
            dailySubjectCount.set(`${day}_${reqObj.subject.name}`, currentDaily + 1);
            placed = true;
            break;
          }
          if (placed) break;
        }
        if (!placed) break;
      }
    }

    for (const reqObj of subjectRequirements) {
      if (reqObj.allocatedCount < reqObj.lecturesPerWeek) {
        warnings.push(`Class ${cls.name}: Only allocated ${reqObj.allocatedCount}/${reqObj.lecturesPerWeek} lectures for ${reqObj.subject.name}.`);
      }
    }

    for (const [gridKey, data] of classGrid.entries()) {
      generatedEntries.push({
        classId: cls._id,
        className: cls.name,
        grade: cls.grade,
        section: cls.section,
        session: session || "2026-2027",
        day: data.day,
        period: data.period.periodNo,
        periodName: data.period.name || `Period ${data.period.periodNo}`,
        startTime: data.period.startTime,
        endTime: data.period.endTime,
        subject: data.reqObj.subject.name,
        teacherName: data.teacher ? data.teacher.name : undefined,
        teacherId: data.teacher ? data.teacher._id : undefined,
        isBreak: false,
        status: "active",
      });
    }
  }

  const targetClassIds = targetClasses.map((c) => c._id);
  await TimetableEntry.deleteMany({ classId: { $in: targetClassIds } });

  if (generatedEntries.length > 0) {
    await TimetableEntry.insertMany(generatedEntries);
  }

  res.json({
    message: `Timetable auto-generated successfully for ${targetClasses.length} class(es)!`,
    totalEntries: generatedEntries.length,
    warnings,
  });
}

const simpleCrud = makeSimpleCrud(TimetableEntry, {
  searchFields: ["subject", "teacherName", "className"],
  sort: { day: 1, period: 1 },
  populate: [
    { path: "classId", select: "name grade section" },
    { path: "teacherId", select: "name subject" },
  ],
  permission: "timetable",
});

module.exports = {
  getStructure,
  updateStructure,
  getGrid,
  bulkSaveGrid,
  autoGenerateTimetable,
  list: simpleCrud.list,
  create: simpleCrud.create,
  update: simpleCrud.update,
  remove: simpleCrud.remove,
};

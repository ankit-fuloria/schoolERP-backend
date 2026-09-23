# Examination workflow

The principal Examinations screen has Structures, Datesheets, Results, and Promotion tabs. Transfers is a separate sidebar tab available to the principal and staff with Students permission.

## Structures and datesheets

- Create an academic year such as `2026-2027`, then one or more named structures.
- Assign grades individually or use the all-classes checkbox. A grade belongs to at most one structure in a year; every section follows its grade's structure.
- Each structure has exactly one final session and any number of mid or sessional sessions. Each session has maximum marks and minimum passing marks.
- Structures are locked after the first datesheet is saved, to preserve references and marks thresholds.
- Datesheets have class rows and date columns, with one subject per class per day. All assigned subjects must be scheduled. Start/end times determine when teachers can enter marks.
- Saved datesheets are visible to assigned teachers and administrators. Only a principal can make them live for parents.

## Results and promotion

- Saving a datesheet snapshots its section rosters and subject names. Datesheet edits are allowed before publication and before marks entry starts.
- Teachers enter numeric marks and a grade for their assigned subjects, after the exam ends. Drafts may be incomplete; submission requires every student.
- A section moves from `draft` to `submitted` when all subjects are submitted. Only its current class teacher can approve it and set every student to pass/fail. Passing below a subject's minimum mark is rejected.
- The class teacher or principal can return unpublished results for correction. Marks are retained, but submissions and approval are reset.
- Only a principal can publish approved sections, with bulk selection. The entire selected batch is validated and committed atomically. Its datesheet must already be live.
- Parents see only live results belonging to their selected linked child. Results retain their original class/section after promotion.
- Promotion is a principal action on live final results. Select a section in the immediately next grade. Only passing, active students without pending transfers move; failed students remain. Movement and skipped student IDs are recorded, and repeating promotion is rejected.
- When final results for the school's highest active grade go live, all active students in that roster enter the pass-out queue, including failed students, as requested. An existing manual transfer is preserved.
- Staff can request a manual transfer with a required remark. Only a principal can complete a transfer, which makes the student inactive. Both actors and timestamps are retained.

## API and deployment

- New workflow endpoints are under `/api/exam-workflow`: `plans`, `cycles`, `results`, subject mark entry, approval, return, publication, and promotion.
- Transfer endpoints are under `/api/transfers`. Staff access uses the existing `students` permission; exam administration uses `examinations`.
- Legacy `/api/exams` remains readable. Legacy write and teacher publish endpoints reject writes so they cannot bypass the approval chain. Existing published legacy results remain in the parent dashboard response.
- New collections: `examplans`, `examcycles`, `sectionexamresults`, `studenttransfers`. Existing student class/status fields and class counts are updated transactionally during promotion/transfer.
- MongoDB must support transactions (a replica set or sharded deployment). The configured database was checked read-only and supports them.
- Concurrent edits require the returned `revision`; stale writes receive HTTP 409. Transactional writes protect publication, promotion, and transfer completion from partial changes.

Run `npm test` for API integration tests against a temporary MongoDB replica set. The first run downloads the test MongoDB binary. Tests use synthetic users and students and do not connect to the school's configured database.

const mongoose = require('mongoose');

/*
 * SCRUM-14 only reads the completed diagnosis prerequisite; it does not own the
 * SCRUM-13 diagnosis workflow. Reading the raw `diagnoses` collection avoids a
 * competing Mongoose model while SCRUM-13 is developed on another branch.
 *
 * Supported integration fields:
 *   job OR jobId                 -> RepairJob ObjectId
 *   completedAt                  -> non-null Date
 *   isCompleted/diagnosisCompleted -> true (accepted fallback)
 *   findings, recommendedWork/recommendedRepairs, publicSummary -> optional context
 */
const findCompletedByJob = async (jobId, session = null) => {
  const objectId = new mongoose.Types.ObjectId(jobId);
  const collection = mongoose.connection.collection('diagnoses');

  const diagnosis = await collection.findOne(
    {
      $and: [
        { $or: [{ job: objectId }, { jobId: objectId }] },
        {
          $or: [
            { completedAt: { $type: 'date' } },
            { isCompleted: true },
            { diagnosisCompleted: true }
          ]
        }
      ]
    },
    session ? { session } : undefined
  );

  return diagnosis;
};

const serializeForStaff = (diagnosis) => {
  if (!diagnosis) return null;

  return {
    id: diagnosis._id,
    findings: diagnosis.findings || diagnosis.diagnosisFindings || null,
    recommendedWork:
      diagnosis.recommendedWork || diagnosis.recommendedRepairs || diagnosis.recommendations || null,
    publicSummary: diagnosis.publicSummary || diagnosis.customerSafeSummary || null,
    isUnrepairable: Boolean(diagnosis.isUnrepairable),
    unrepairableReason: diagnosis.unrepairableReason || null,
    completedAt: diagnosis.completedAt || null
  };
};

module.exports = {
  findCompletedByJob,
  serializeForStaff
};

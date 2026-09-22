const RepairJob = require('../models/RepairJob');

const create = (data) => RepairJob.create(data);

const findByIdempotency = (createdBy, idempotencyKey) => RepairJob.findOne({
  createdBy,
  idempotencyKey
}).select('+idempotencyKey +requestHash');

module.exports = {
  create,
  findByIdempotency
};

const { Schema, model, models } = require("mongoose");
const { optionalDateField, requiredDateField } = require("./dateFields");

const timetableDaySchema = new Schema(
  {
    active: { type: Boolean, required: true, default: false },
    shift: { type: String, required: true, default: "Flexible", trim: true },
    start: { type: String, required: true, default: "09:00", trim: true },
    end: { type: String, required: true, default: "17:00", trim: true },
  },
  {
    _id: false,
  }
);

const timetableSchema = new Schema(
  {
    monday: { type: timetableDaySchema, required: true, default: () => ({}) },
    tuesday: { type: timetableDaySchema, required: true, default: () => ({}) },
    wednesday: { type: timetableDaySchema, required: true, default: () => ({}) },
    thursday: { type: timetableDaySchema, required: true, default: () => ({}) },
    friday: { type: timetableDaySchema, required: true, default: () => ({}) },
    saturday: { type: timetableDaySchema, required: true, default: () => ({}) },
    sunday: { type: timetableDaySchema, required: true, default: () => ({}) },
  },
  {
    _id: false,
  }
);

const userSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    staffId: { type: String, required: true, unique: true, trim: true, index: true },
    pinHash: { type: String, required: false, default: "", trim: true },
    fullName: { type: String, required: true, trim: true },
    role: { type: String, required: true, trim: true, index: true },
    roleId: { type: Number, default: null, index: true },
    department: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, index: true },
    phone: { type: String, default: "", trim: true },
    status: { type: String, required: true, default: "Active", trim: true, index: true },
    pinStatus: { type: String, required: true, default: "Assigned", trim: true },
    invitedAt: optionalDateField(),
    approvedAt: optionalDateField(),
    approvedBy: { type: String, default: "", trim: true },
    pinUpdatedAt: optionalDateField(),
    shiftAssignment: { type: String, required: true, default: "Unassigned", trim: true },
    staffNotes: { type: String, required: false, default: "", trim: true },
    incidentFlag: { type: String, required: true, default: "Clear", trim: true },
    incidentNote: { type: String, required: false, default: "", trim: true },
    forcePinChange: { type: Boolean, required: true, default: false },
    isPinned: { type: Boolean, required: true, default: false },
    timetable: { type: timetableSchema, required: true, default: () => ({}) },
    createdAt: requiredDateField(),
    updatedAt: requiredDateField(),
  },
  {
    versionKey: false,
  }
);

module.exports = models.User || model("User", userSchema);

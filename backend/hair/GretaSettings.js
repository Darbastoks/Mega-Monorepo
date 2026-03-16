const mongoose = require('mongoose');

const gretaSettingsSchema = new mongoose.Schema({
    workingDays: {
        type: [Number],
        default: [1, 2, 3, 4, 5, 6]
    },
    startHour: {
        type: String,
        default: '09:00'
    },
    endHour: {
        type: String,
        default: '19:00'
    },
    breakStart: {
        type: String,
        default: ''
    },
    breakEnd: {
        type: String,
        default: ''
    },
    blockedDates: {
        type: [String],
        default: []
    }
});

module.exports = mongoose.model('GretaSettings', gretaSettingsSchema);

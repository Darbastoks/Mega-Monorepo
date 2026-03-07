const mongoose = require('mongoose');

const gretaServiceSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    duration: {
        type: Number,
        default: 60
    },
    price: {
        type: Number,
        default: 0
    },
    description: {
        type: String,
        default: ''
    }
});

module.exports = mongoose.model('GretaService', gretaServiceSchema);

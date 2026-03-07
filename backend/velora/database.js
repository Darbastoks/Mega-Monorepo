const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const veloraAdminSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const veloraLeadSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    message: { type: String },
    status: { type: String, enum: ['new', 'contacted', 'resolved', 'cancelled'], default: 'new' },
    created_at: { type: Date, default: Date.now }
});

const VeloraAdmin = mongoose.model('VeloraAdmin', veloraAdminSchema);
const VeloraLead = mongoose.model('VeloraLead', veloraLeadSchema);

async function initVeloraDatabase() {
    try {
        // Seed default Velora Admin if not exists
        const adminCount = await VeloraAdmin.countDocuments();
        if (adminCount === 0) {
            const hashedPassword = bcrypt.hashSync('velora2024', 10);
            await VeloraAdmin.create({ username: 'admin', password: hashedPassword });
            console.log('✅ Default Velora admin account created (admin / velora2024)');
        }
    } catch (error) {
        console.error('❌ Velora Database Seeding Error:', error.message);
    }
}

module.exports = {
    VeloraAdmin,
    VeloraLead,
    initVeloraDatabase
};

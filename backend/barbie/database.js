const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Define Schemas
const adminSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const serviceSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    description: { type: String },
    duration: { type: Number, default: 30 },
    sort_order: { type: Number, default: 0 }
});

const bookingSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String },
    service: { type: String, required: true },
    date: { type: String, required: true }, // Format: YYYY-MM-DD
    time: { type: String, required: true }, // Format: HH:MM
    message: { type: String },
    status: { type: String, enum: ['pending', 'confirmed', 'cancelled'], default: 'pending' },
    created_at: { type: Date, default: Date.now }
});

// Compile Models
const Admin = mongoose.model('Admin', adminSchema);
const Service = mongoose.model('Service', serviceSchema);
const Booking = mongoose.model('Booking', bookingSchema);

// Initialize Database Connection
async function initDatabase() {
    try {
        if (!process.env.MONGO_URI && !process.env.MONGODB_URI) {
            console.warn('⚠️ MONGO_URI string is not defined in .env file. Running without database.');
            return;
        }

        const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
        await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 5000 // 5 second timeout
        });
        console.log('✅ Connected to MongoDB successfully');

        // Disable buffering if connected
        mongoose.set('bufferCommands', false);

        // Seed default Admin if not exists
        const adminCount = await Admin.countDocuments();
        if (adminCount === 0) {
            const hashedPassword = bcrypt.hashSync('barber2024', 10);
            await Admin.create({ username: 'admin', password: hashedPassword });
            console.log('✅ Default admin account created (admin / barber2024)');
        }

        // Seed default Services if not exists
        const servicesCount = await Service.countDocuments();
        if (servicesCount === 0) {
            const defaultServices = [
                { name: 'Plaukų kirpimas', price: 25, description: 'Profesionalus vyrų plaukų kirpimas', duration: 30, sort_order: 1 },
                { name: 'Barzdos modeliavimas', price: 25, description: 'Barzdos formavimas ir modeliavimas', duration: 30, sort_order: 2 },
                { name: 'Barzda su karštų rankšluosčių', price: 25, description: 'Barzdos tvarkymas su karštais rankšluosčiais', duration: 35, sort_order: 3 },
                { name: 'Kirpimas + barzdos modeliavimas', price: 35, description: 'Plaukų kirpimas kartu su barzdos modeliavimu', duration: 50, sort_order: 4 },
                { name: 'Grožio kaukė + antakių korekcija', price: 15, description: 'Veido kaukė ir antakių korekcija', duration: 20, sort_order: 5 },
                { name: 'Dažymo konsultacija', price: 5, description: 'Konsultacija dėl plaukų dažymo', duration: 15, sort_order: 6 },
                { name: 'Kirpimas + barzda + grožio kaukė', price: 40, description: 'Pilnas kompleksas: kirpimas, barzda ir kaukė', duration: 60, sort_order: 7 },
                { name: 'Kompleksas (viskas)', price: 50, description: 'Kirpimas + barzda + karšti rankšluosčiai + kaukė', duration: 75, sort_order: 8 }
            ];
            await Service.insertMany(defaultServices);
            console.log('✅ Default services inserted');
        }

    } catch (error) {
        console.error('❌ MongoDB Connection Error:', error.message);
        // Do NOT exit process, let fallback login work
    }
}

module.exports = {
    initDatabase,
    Admin,
    Service,
    Booking
};

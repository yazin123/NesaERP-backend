const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate } = require('../../middleware/auth');
const userController = require('../../controllers/common/userController');

// Configure multer for profile photo uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../../uploads/photos');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const uploadMulter = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (!file.originalname.match(/\.(jpg|jpeg|png)$/)) {
            return cb(new Error('Only image files are allowed!'), false);
        }
        cb(null, true);
    }
});

// Authentication routes
router.post('/login', userController.login);
router.post('/logout', authenticate, userController.logout);

// Profile routes
router.get('/current', authenticate, userController.getCurrentUser);
router.get('/profile/photo/:filename', userController.getProfilePhoto);
router.put('/profile', authenticate, userController.updateProfile);
router.put('/profile/password', authenticate, userController.changePassword);
router.put('/profile/photo', authenticate, uploadMulter.single('photo'), userController.updatePhoto);

module.exports = router; 
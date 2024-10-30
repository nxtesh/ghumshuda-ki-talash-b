require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const faceapi = require("face-api.js");
const canvas = require("canvas");
const { Canvas, Image, ImageData } = canvas;



// Configure face-api.js to use canvas for image processing
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Multer setup for image upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// MongoDB connection
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Connected to MongoDB"))
  .catch((error) => console.log("Error connecting to MongoDB:", error));

// Person Schema
const personSchema = new mongoose.Schema(
  {
    name: String,
    age: Number,
    lastSeen: Date,
    details: String,
    phoneNumber: String,
    picture: String,
    state: String,
    city: String,
    address: String,
    nameOfPolice: String,
    FIRDate: Date,
    FIRCaseNumber: String,
    officerInChargeNumber: String,
    isFound: { type: Boolean, default: false },
    feedback: [{ text: String, date: { type: Date, default: Date.now } }],
  },
  { timestamps: true } // Added timestamps to use in sorting
);

const Person = mongoose.model("Person", personSchema);

// Load face recognition models
const loadModels = async () => {
  const MODEL_URL = path.join(__dirname, "models");
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_URL);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_URL);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_URL);
  console.log("Face recognition models loaded");
};

loadModels();

// Function to recognize face
const recognizeFace = async (imagePath) => {
  const image = await canvas.loadImage(imagePath);
  const detections = await faceapi
    .detectAllFaces(image)
    .withFaceLandmarks()
    .withFaceDescriptors();

  return detections;
};

// Routes

// Add Person Route
app.post("/add-person", upload.single("picture"), async (req, res) => {
  const {
    name,
    age,
    lastSeen,
    details,
    phoneNumber,
    state,
    city,
    address,
    nameOfPolice,
    FIRDate,
    FIRCaseNumber,
    officerInChargeNumber,
  } = req.body;
  const picture = req.file ? req.file.path : "";

  try {
    const newPerson = new Person({
      name,
      age,
      lastSeen,
      details,
      phoneNumber,
      picture,
      state,
      city,
      address,
      nameOfPolice,
      FIRDate,
      FIRCaseNumber,
      officerInChargeNumber,
    });
    await newPerson.save();
    res.status(201).json(newPerson);
  } catch (error) {
    res.status(500).json({ error: "Failed to add person" });
  }
});

// Face Recognition Route
app.post("/check-face", upload.single("picture"), async (req, res) => {
  const picturePath = req.file.path;

  try {
    const newFaceDetections = await recognizeFace(picturePath);

    const persons = await Person.find();
    let isMatchFound = false;
    let matchedPerson = null;

    for (const person of persons) {
      if (person.picture) {
        const existingFaceDetections = await recognizeFace(person.picture);

        for (const newFace of newFaceDetections) {
          for (const existingFace of existingFaceDetections) {
            const distance = faceapi.euclideanDistance(
              newFace.descriptor,
              existingFace.descriptor
            );

            if (distance < 0.6) {
              isMatchFound = true;
              matchedPerson = person;
              break;
            }
          }
          if (isMatchFound) break;
        }
        if (isMatchFound) break;
      }
    }

    if (isMatchFound) {
      res.status(200).json({ match: true, person: matchedPerson });
    } else {
      res.status(200).json({ match: false });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to recognize face" });
  }
});

// Get All Persons Route with optional filters
app.get("/persons", async (req, res) => {
  const { name, age, state, city } = req.query;

  let filter = { isFound: false };
  if (name) filter.name = new RegExp(name, "i"); // Case-insensitive search
  if (age) filter.age = age;
  if (state) filter.state = state; // Add state filter
  if (city) filter.city = city; // Add city filter

  try {
    const persons = await Person.find(filter);
    res.status(200).json(persons);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch persons" });
  }
});

// Get Person by ID Route
app.get("/persons/:id", async (req, res) => {
  try {
    const person = await Person.findById(req.params.id);
    if (!person) return res.status(404).json({ error: "Person not found" });
    res.status(200).json(person);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch person" });
  }
});

// Add Feedback to Person Route
app.post("/persons/:id/feedback", async (req, res) => {
  const { text } = req.body;
  try {
    const person = await Person.findById(req.params.id);
    if (!person) return res.status(404).json({ error: "Person not found" });

    person.feedback.push({ text });
    await person.save();
    res.status(200).json({ feedback: person.feedback });
  } catch (error) {
    res.status(500).json({ error: "Failed to add feedback" });
  }
});

// Mark Person as Found Route
app.post("/persons/:id/mark-as-found", async (req, res) => {
  try {
    const person = await Person.findById(req.params.id);
    if (!person) return res.status(404).json({ error: "Person not found" });

    person.isFound = true;
    await person.save();

    res.status(200).json(person);
  } catch (error) {
    res.status(500).json({ error: "Failed to mark person as found" });
  }
});

// Get All Found Persons Route
app.get("/found-persons", async (req, res) => {
  try {
    const persons = await Person.find({ isFound: true });
    res.status(200).json(persons);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch found persons" });
  }
});

// Delete Person Route
app.delete("/persons/:id", async (req, res) => {
  try {
    await Person.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Person deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete person" });
  }
});

// Get Statistics Route
app.get("/statistics", async (req, res) => {
  try {
    const totalCases = await Person.countDocuments();
    const foundPersons = await Person.countDocuments({ isFound: true });

    res.json({ totalCases, foundPersons });
  } catch (error) {
    console.error("Error fetching statistics:", error);
    res.status(500).json({ error: "Error fetching statistics" });
  }
});

// Get Recent Persons Route
app.get("/recent-persons", async (req, res) => {
  try {
    const recentPersons = await Person.find().sort({ createdAt: -1 }).limit(3);
    res.json(recentPersons);
  } catch (error) {
    res.status(500).json({ message: "Error fetching recent persons" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

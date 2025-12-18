import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";


const app = express();

/* Middleware */
app.use(cors(
  {
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
  }
));

app.use(express.json(
  {
    limit:"100kb"
  }
));

app.use(express.urlencoded({ extended: true, limit: "100kb" }));

app.use(express.static("public"));

app.use(cookieParser());

// /* Routes */
// app.get("/", (req, res) => {
//   res.json({ message: "Hello World" });
// });

// /* 404 Handler */
// app.use((req, res) => {
//   res.status(404).json({ error: "Route not found" });
// });

// /* Error Handler */
// app.use((err, req, res, next) => {
//   console.error(err.stack);
//   res.status(err.statusCode || 500).json({
//     error: err.message || "Internal Server Error",
//   });
// });

export default app;

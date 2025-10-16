// 1️⃣ Import all required packages
import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";

// 2️⃣ Load environment variables from .env file
dotenv.config();
// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);



// 🪄 DEBUG: Print your environment variables
console.log("Loaded environment variables:");
console.log("MAIL_USER:", process.env.MAIL_USER);
console.log("MAIL_PASS:", process.env.MAIL_PASS ? "********" : "❌ Not Loaded");
console.log("RECEIVER_MAIL:", process.env.RECEIVER_MAIL);
console.log("SUPABASE_URL:", process.env.SUPABASE_URL || "❌ Not Loaded");
console.log("SUPABASE_KEY:", process.env.SUPABASE_KEY ? "********" : "❌ Not Loaded");
console.log("PORT:", process.env.PORT || "5000");

// 3️⃣ Create an Express app
const app = express();

// 4️⃣ Middlewares (to parse JSON and allow cross-origin requests)
app.use(cors());
app.use(express.json());

// 5️⃣ Define the route that handles the form submission
// 📨 Contact Form API Route
app.post("/api/contact", async (req, res) => {
  const { fullName, email, company, need, message } = req.body;

  if (!fullName || !email || !message)
    return res.status(400).json({ error: "Missing required fields" });

  try {
    // 1️⃣ Send email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"Website Contact" <${process.env.MAIL_USER}>`,
      to: process.env.RECEIVER_MAIL,
      subject: `New contact from ${fullName}`,
      html: `
        <h2>New Contact Submission</h2>
        <p><b>Name:</b> ${fullName}</p>
        <p><b>Email:</b> ${email}</p>
        <p><b>Company:</b> ${company || "N/A"}</p>
        <p><b>Need:</b> ${need || "N/A"}</p>
        <p><b>Message:</b><br/>${message}</p>
      `,
    };

    await transporter.sendMail(mailOptions);

    // 2️⃣ Save in Supabase
    const { data, error } = await supabase.from("contacts").insert([
      {
        full_name: fullName,
        email,
        company,
        need,
        message,
        subscription: false, // default value
      },
    ]);

    if (error) {
      console.error("Supabase insert error:", error);
      return res.status(500).json({ error: "Failed to save to database" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: "Failed to process request" });
  }
});



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.post("/api/subscribe", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    console.log("❌ Missing email for subscription update");
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    console.log("🔍 Checking subscription for:", email);

    // 1️⃣ Check if email exists
    const { data: userData, error: fetchError } = await supabase
      .from("contacts")
      .select("*")
      .eq("email", email);

    if (fetchError) {
      console.error("❌ Error fetching user:", fetchError.message);
      return res.status(500).json({ error: "Database fetch failed" });
    }

    // 2️⃣ If exists
    if (userData && userData.length > 0) {
      const user = userData[0];

      if (user.subscription === true) {
        console.log("ℹ️ Already subscribed:", email);
        // Still send welcome message (as per your new requirement)
      } else {
        // Update subscription if false
        const { error: updateError } = await supabase
          .from("contacts")
          .update({ subscription: true })
          .eq("email", email);

        if (updateError) {
          console.error("❌ Subscription update error:", updateError.message);
          return res.status(500).json({ error: "Failed to update subscription" });
        }

        console.log("✅ Updated existing user subscription:", email);
      }
    } else {
      // 3️⃣ If no existing record — create new one
      const { error: insertError } = await supabase.from("contacts").insert([
        {
          email,
          subscription: true,
          full_name: null,
          company: null,
          need: null,
          message: null,
        },
      ]);

      if (insertError) {
        console.error("❌ Insert error:", insertError.message);
        return res.status(500).json({ error: "Failed to add new subscriber" });
      }

      console.log("✅ Added new subscriber:", email);
    }

    // 4️⃣ Always send Welcome Email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });

    const logoPath = path.join(__dirname, "assets", "goftus-logo.jpg");

    const mailOptions = {
      from: `"Goftus AI" <${process.env.MAIL_USER}>`,
      to: email,
      subject: "🎉 Welcome to Goftus AI!",
      attachments: [
        {
          filename: "goftus-logo.jpg",
          path: logoPath,
          cid: "goftuslogo",
        },
      ],
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #0f172a; padding: 40px;">
          <div style="max-width: 600px; margin: auto; background: #1e293b; border-radius: 12px; overflow: hidden;">
            <div style="text-align: center; padding: 30px 20px;">
              <img src="cid:goftuslogo" alt="Goftus Logo" style="width: 120px; margin-bottom: 15px;" />
              <h1 style="color: #38bdf8; font-size: 26px;">Welcome to Goftus AI</h1>
              <p style="color: #e2e8f0; font-size: 15px; line-height: 1.6;">
                We're excited to have you join the Goftus community.
              </p>
            </div>

            <div style="padding: 20px 30px;">
              <p style="color: #cbd5e1; font-size: 15px;">
                At <strong style="color: #38bdf8;">Goftus</strong>, we help you build, ship, and scale with advanced AI solutions like:
              </p>
              <ul style="color: #e2e8f0; font-size: 15px; line-height: 1.8;">
                <li><b>🤖 Agentic AI</b> — automate business workflows intelligently</li>
                <li><b>🚀 AI Products</b> — design, deploy, and scale effortlessly</li>
                <li><b>⚙️ Smart Integrations</b> — bring AI seamlessly into your stack</li>
              </ul>
              <p style="color: #cbd5e1; margin-top: 15px;">
                Let’s shape the future of AI — together.
              </p>

              <div style="text-align: center; margin-top: 30px;">
                <a href="https://goftus.com/contact"
                   style="background-color: #38bdf8; color: #0f172a; padding: 12px 24px; border-radius: 8px; font-weight: bold; text-decoration: none;">
                  Contact Us
                </a>
              </div>
            </div>

            <div style="background: #0f172a; text-align: center; padding: 15px;">
              <p style="color: #64748b; font-size: 12px;">
                © ${new Date().getFullYear()} Goftus AI. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log("✅ Welcome email sent to:", email);

    return res.json({
      success: true,
      message: "Subscription activated and welcome email sent!",
    });
  } catch (err) {
    console.error("❌ Error processing subscription:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
// Start the Express server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
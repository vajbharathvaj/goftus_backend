// 1️⃣ Import all required packages
import express from "express";
import cors from "cors";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";

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
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "goftus-admin-token";

const encodeAdminToken = (email) =>
  `${ADMIN_TOKEN}.${Buffer.from(email).toString("base64")}`;

const decodeAdminEmail = (token) => {
  if (!token.startsWith(`${ADMIN_TOKEN}.`)) return null;
  const encoded = token.slice(ADMIN_TOKEN.length + 1);
  try {
    return Buffer.from(encoded, "base64").toString("utf8");
  } catch (err) {
    return null;
  }
};

const findAdminByEmail = async (email) => {
  if (!email) return null;
  if (ADMIN_EMAIL && email === ADMIN_EMAIL) {
    return { email, isSuperAdmin: true };
  }
  const { data, error } = await supabase
    .from("admin_users")
    .select("id,email")
    .eq("email", email)
    .maybeSingle();
  if (error || !data) return null;
  return { ...data, isSuperAdmin: false };
};

const requireAdmin = async (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    return res.status(500).json({ error: "Admin credentials not configured" });
  }

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const email = decodeAdminEmail(token);
  const admin = await findAdminByEmail(email);
  if (!admin) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.adminEmail = admin.email;
  req.isSuperAdmin = admin.isSuperAdmin;
  return next();
};

const requireSuperAdmin = async (req, res, next) => {
  await requireAdmin(req, res, () => {
    if (!req.isSuperAdmin) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  });
};

const parsePagination = (req) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 9, 1), 50);
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  return { page, limit, from, to };
};

// --- Blog Admin Auth ---
app.post("/api/admin/login", async (req, res) => {
  const { email, username, password } = req.body || {};
  const candidate = email || username;

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    return res.status(500).json({ error: "Admin credentials not configured" });
  }

  if (candidate === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    return res.json({
      token: encodeAdminToken(candidate),
      email: candidate,
      isSuperAdmin: true,
    });
  }

  const { data, error } = await supabase
    .from("admin_users")
    .select("id,email,password_hash")
    .eq("email", candidate)
    .maybeSingle();

  if (error || !data) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password || "", data.password_hash || "");
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  return res.json({
    token: encodeAdminToken(data.email),
    email: data.email,
    isSuperAdmin: false,
  });
});

// --- Public Blog Endpoints ---
app.get("/api/posts", async (req, res) => {
  const { page, limit, from, to } = parsePagination(req);

  const { data, error, count } = await supabase
    .from("posts")
    .select("*", { count: "exact" })
    .eq("status", "published")
    .order("published_at", { ascending: false, nullsLast: true })
    .range(from, to);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const totalPages = count ? Math.ceil(count / limit) : 1;
  return res.json({ posts: data || [], page, totalPages, total: count || 0 });
});

app.get("/api/posts/:slug", async (req, res) => {
  const { slug } = req.params;
  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (error || !data) {
    return res.status(404).json({ error: "Post not found" });
  }

  return res.json(data);
});

// --- Public Products Endpoint ---
app.get("/api/products", async (req, res) => {
  const { subtitle, status } = req.query;
  let query = supabase.from("products").select("*").order("created_at", { ascending: false });

  if (subtitle) {
    query = query.eq("subtitle", subtitle);
  }
  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  return res.json({ products: data || [] });
});

// --- Public Banner Endpoint ---
app.get("/api/banner", async (req, res) => {
  const { data, error } = await supabase
    .from("banners")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json(data || null);
});

// --- Admin Blog Endpoints ---
app.get("/api/admin/posts", requireAdmin, async (req, res) => {
  const { data, error, count } = await supabase
    .from("posts")
    .select("*", { count: "exact" })
    .order("updated_at", { ascending: false, nullsLast: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ posts: data || [], total: count || 0 });
});

app.post("/api/admin/posts", requireAdmin, async (req, res) => {
  const payload = req.body || {};
  if (!payload.title || !payload.slug) {
    return res.status(400).json({ error: "Missing title or slug" });
  }

  const { data, error } = await supabase.from("posts").insert([payload]).select("*").single();
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json(data);
});

app.put("/api/admin/posts/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const payload = req.body || {};

  const { data, error } = await supabase
    .from("posts")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json(data);
});

app.delete("/api/admin/posts/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase.from("posts").delete().eq("id", id);
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ success: true });
});

app.post("/api/admin/posts/:id/publish", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const payload = { status: "published", published_at: new Date().toISOString() };

  const { data, error } = await supabase
    .from("posts")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json(data);
});

app.post("/api/admin/posts/:id/unpublish", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const payload = { status: "draft", published_at: null };

  const { data, error } = await supabase
    .from("posts")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json(data);
});

// --- Admin Products Endpoints ---
app.get("/api/admin/products", requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("updated_at", { ascending: false, nullsLast: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ products: data || [] });
});

app.post("/api/admin/products", requireAdmin, async (req, res) => {
  const payload = req.body || {};
  if (!payload.name || !payload.description) {
    return res.status(400).json({ error: "Missing name or description" });
  }

  const { data, error } = await supabase.from("products").insert([payload]).select("*").single();
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json(data);
});

app.post("/api/admin/products/upload-image", requireAdmin, async (req, res) => {
  const { dataUrl, filename } = req.body || {};
  if (!dataUrl || !filename) {
    return res.status(400).json({ error: "Missing dataUrl or filename" });
  }

  const match = String(dataUrl).match(/^data:(.+);base64,(.+)$/);
  if (!match) {
    return res.status(400).json({ error: "Invalid data URL" });
  }

  const contentType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const objectPath = `products/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage
    .from("product-images")
    .upload(objectPath, buffer, { contentType, upsert: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const { data } = supabase.storage.from("product-images").getPublicUrl(objectPath);
  return res.json({ url: data.publicUrl });
});

app.put("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const payload = req.body || {};

  const { data, error } = await supabase
    .from("products")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json(data);
});

app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ success: true });
});

// --- Admin Banner Endpoints ---
app.get("/api/admin/banners", requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("banners")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ banners: data || [] });
});

app.post("/api/admin/banners", requireAdmin, async (req, res) => {
  const { product, message, href, is_active } = req.body || {};
  if (!product || !message) {
    return res.status(400).json({ error: "Missing product or message" });
  }

  const payload = {
    product,
    message,
    href: href || null,
    is_active: Boolean(is_active),
  };

  const { data, error } = await supabase
    .from("banners")
    .insert([payload])
    .select("*")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (payload.is_active) {
    await supabase.from("banners").update({ is_active: false }).neq("id", data.id);
  }

  return res.json(data);
});

app.put("/api/admin/banners/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { product, message, href, is_active } = req.body || {};

  const payload = {};
  if (typeof product === "string") payload.product = product;
  if (typeof message === "string") payload.message = message;
  if (typeof href === "string" || href === null) payload.href = href || null;
  if (typeof is_active === "boolean") payload.is_active = is_active;

  if (payload.is_active === true) {
    await supabase.from("banners").update({ is_active: false }).neq("id", id);
  }

  const { data, error } = await supabase
    .from("banners")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json(data);
});

app.post("/api/admin/banners/:id/activate", requireAdmin, async (req, res) => {
  const { id } = req.params;

  await supabase.from("banners").update({ is_active: false }).neq("id", id);

  const { data, error } = await supabase
    .from("banners")
    .update({ is_active: true })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json(data);
});

app.post("/api/admin/banners/:id/deactivate", requireAdmin, async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("banners")
    .update({ is_active: false })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json(data);
});

app.delete("/api/admin/banners/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase.from("banners").delete().eq("id", id);
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ success: true });
});

// --- Admin Users (Super Admin Only) ---
app.get("/api/admin/users", requireSuperAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("admin_users")
    .select("id,email,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ users: data || [] });
});

app.post("/api/admin/users", requireSuperAdmin, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  if (ADMIN_EMAIL && email === ADMIN_EMAIL) {
    return res.status(400).json({ error: "Cannot add primary admin here" });
  }

  const password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from("admin_users")
    .insert([{ email, password_hash }])
    .select("id,email,created_at")
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json(data);
});

app.delete("/api/admin/users/:id", requireSuperAdmin, async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase.from("admin_users").delete().eq("id", id);
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({ success: true });
});

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
      return res.status(500).json({
        error: "Failed to save to database",
        detail: error.message || error,
        source: "supabase_insert",
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({
      error: "Failed to process request",
      detail: err?.message || err,
      source: "contact_handler",
    });
  }
});

// 📨 Automation Prompt API Route
app.post("/api/automation-inquiry", async (req, res) => {
  const { choice, phone } = req.body || {};

  if (!choice) {
    return res.status(400).json({ error: "Missing choice" });
  }

  if ((choice === "yes" || choice === "maybe") && !phone) {
    return res.status(400).json({ error: "Missing phone number" });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"Automation Prompt" <${process.env.MAIL_USER}>`,
      to: process.env.RECEIVER_MAIL,
      subject: "New AI Automation Inquiry",
      html: `
        <h2>AI Automation Inquiry</h2>
        <p><b>Answer:</b> ${choice}</p>
        <p><b>Mobile:</b> ${phone || "N/A"}</p>
      `,
    };

    await transporter.sendMail(mailOptions);

    return res.json({ success: true });
  } catch (err) {
    console.error("Automation inquiry error:", err);
    return res.status(500).json({
      error: "Failed to process request",
      detail: err?.message || err,
      source: "automation_inquiry",
    });
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
                <br>
                <a href="${process.env.BASE_URL}/api/unsubscribe?email=${encodeURIComponent(email)}"
   style="display:inline-block; margin-top:20px; color:#94a3b8; font-size:13px; text-decoration:underline;">
   Unsubscribe from future emails
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
app.get("/api/unsubscribe", async (req, res) => {
  try {
    const email = req.query.email;

    // 🔒 Step 1: Validate query parameter
    if (!email || !email.includes("@")) {
      console.warn("❌ Invalid unsubscribe request - missing or invalid email");
      return res.status(400).send("Invalid unsubscribe link.");
    }

    console.log("📩 Unsubscribe request for:", email);

    // 🔍 Step 2: Check if the user exists
    const { data: userData, error: fetchError } = await supabase
      .from("contacts")
      .select("*")
      .eq("email", email);

    if (fetchError) {
      console.error("❌ Database fetch error:", fetchError.message);
      return res.status(500).send("Internal server error.");
    }

    if (!userData || userData.length === 0) {
      console.warn("⚠️ No user found for:", email);
      return res.status(404).send("Email not found in database.");
    }

    const user = userData[0];

    // 🚫 Step 3: If already unsubscribed
    if (user.subscription === false) {
      console.log("ℹ️ Already unsubscribed:", email);
      return res
        .status(200)
        .send(
          `<html>
            <body style="font-family:Arial,sans-serif; background:#f9fafb; text-align:center; padding:50px;">
              <h2 style="color:#1E3A8A;">You’re already unsubscribed!</h2>
              <p style="color:#4B5563;">We won't send further updates to <b>${email}</b>.</p>
            </body>
          </html>`
        );
    }

    // ✏️ Step 4: Update subscription to false
    const { error: updateError } = await supabase
      .from("contacts")
      .update({ subscription: false })
      .eq("email", email);

    if (updateError) {
      console.error("❌ Unsubscribe update error:", updateError.message);
      return res.status(500).send("Failed to update subscription.");
    }

    console.log("✅ Subscription marked false for:", email);

    // ✉️ Step 5: Send confirmation email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"Goftus AI" <${process.env.MAIL_USER}>`,
      to: email,
      subject: "You’ve been unsubscribed from Goftus AI updates",
      html: `
        <div style="font-family:Arial,sans-serif; background-color:#f9fafb; padding:30px;">
          <div style="max-width:600px;margin:auto;background:white;border-radius:12px;padding:20px;">
            <h2 style="color:#1E3A8A;text-align:center;">Unsubscribed Successfully</h2>
            <p style="color:#374151;text-align:center;">We’ve removed <b>${email}</b> from our mailing list.</p>
            <p style="font-size:14px;color:#6B7280;text-align:center;">If this was a mistake, you can resubscribe anytime on our website.</p>
            <div style="text-align:center;margin-top:30px;">
              <a href="https://goftus.com" 
                 style="background:#1E3A8A;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;">
                Visit Goftus
              </a>
            </div>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log("📨 Confirmation email sent to:", email);

    // ✅ Step 6: Send browser confirmation page
    return res
      .status(200)
      .send(
        `<html>
          <body style="font-family:Arial,sans-serif; background:#f9fafb; text-align:center; padding:50px;">
            <h2 style="color:#1E3A8A;">You’ve been unsubscribed.</h2>
            <p style="color:#4B5563;">We’re sorry to see you go! A confirmation email was sent to <b>${email}</b>.</p>
          </body>
        </html>`
      );
  } catch (err) {
    console.error("❌ Unsubscribe processing error:", err);
    res.status(500).send("Internal server error.");
  }
});

import express from "express";
import session from "cookie-session";
import passport from "./passport-config";
import { google } from "googleapis";
import { v4 } from "uuid";
import ngrok from "ngrok";

const app = express();
const PORT = 3000;

app.use(
  session({
    name: "google-auth-session",
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.get("/", (req, res) => {
  if (req.isAuthenticated()) {
    return res.send(
      `Welcome, ${req.user.email}! <a href="/setup-watch>Setup Calendar Watch</a>`
    );
  }
  return res.send('<a href="/auth/google">Login with Google</a>');
});

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: [
      "profile",
      "email",
      "https://www.googleapis.com/auth/calendar.events",
    ],
  })
);

app.get(
  "auth/google/callback",
  passport.authenticate("google", {
    successRedirect: "/",
    failureRedirect: "/login-failed",
  })
);

app.get("/login-failed", (req, res) => {
  res.send('Login Failed. <a href="/">Try again</a>');
});

app.get("/logout", (req, res) => {
  req.logOut((err) => {
    if (err) {
      return nextTick(err);
    }
    return res.redirect("/");
  });
});

app.get("/setup-watch", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/");
  }

  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: req.user.accessToken,
      refresh_token: req.user.refreshToken,
    });

    const calendar = google.calendar({
      version: "v3",
      auth: oauth2Client,
    });

    const channelId = v4();

    const webhookUrl = await ngrok.connect(PORT);
    const watchResponse = await calendar.events.watch({
      calendarId: "primary",
      requestBody: {
        id: channelId,
        type: "web_hook",
        address: `${webhookUrl}/webhook`,
        params: {
          ttl: "3600",
        },
      },
    });

    console.log("Watch setup:", watchResponse.data);
    res.send(
      "Calendar watch has been set up successfully. Channel ID: " + channelId
    );
  } catch (error) {
    console.error("Error setting up watch:", error);
    res.status(500).send("Failed to set up calendar watch.");
  }
});

// Webhook endpoint to receive notifications
app.post("/webhook", express.json(), (req, res) => {
  // Headers from Google notification
  const resourceState = req.headers["x-goog-resource-state"];
  const channelId = req.headers["x-goog-channel-id"];
  const resourceId = req.headers["x-goog-resource-id"];

  console.log(
    `Notification received: State=${resourceState}, Channel=${channelId}, Resource=${resourceId}`
  );

  if (resourceState === "sync") {
    // Initial sync message; respond OK
    return res.status(200).send("Sync acknowledged");
  } else if (resourceState === "exists") {
    // Event changed; fetch updated events here
    // Example: Use googleapis to list recent events (implement as needed)
    console.log("Event change detected! Fetch updates...");
  } else if (resourceState === "not_exists") {
    // Resource deleted
    console.log("Resource deleted.");
  }

  res.status(200).send("Notification received");
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

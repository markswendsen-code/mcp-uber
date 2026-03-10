#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Page } from "playwright";
import { withPage, navigateToUber, saveSessionCookies } from "./browser.js";
import {
  isLoggedIn,
  loadAuth,
  saveAuth,
  clearCookies,
  saveRoute,
  loadRoute,
  clearRoute,
} from "./session.js";

// ─── Server setup ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: "uber", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ─── Tool definitions ─────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "status",
      description: "Check Uber authentication and session status, including current pickup/destination if set",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "login",
      description:
        "Authenticate with Uber using email/phone and password via browser automation. For phone-based accounts an OTP may be required — use headless=false to complete verification manually.",
      inputSchema: {
        type: "object",
        properties: {
          identifier: {
            type: "string",
            description: "Uber account email address or phone number",
          },
          password: {
            type: "string",
            description: "Uber account password",
          },
          headless: {
            type: "boolean",
            description:
              "Run browser in headless mode (default: true). Set false to see the browser and complete any OTP/captcha manually.",
          },
        },
        required: ["identifier", "password"],
      },
    },
    {
      name: "logout",
      description: "Clear Uber session and stored cookies",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "set_pickup",
      description: "Set the pickup location for a ride request",
      inputSchema: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "Pickup address (e.g., '123 Main St, New York, NY' or 'JFK Airport')",
          },
        },
        required: ["address"],
      },
    },
    {
      name: "set_destination",
      description: "Set the destination for a ride request",
      inputSchema: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description: "Destination address (e.g., '456 Park Ave, New York, NY' or 'LaGuardia Airport')",
          },
        },
        required: ["address"],
      },
    },
    {
      name: "get_fare_estimate",
      description:
        "Get fare estimates for all available ride types between the current pickup and destination. Requires pickup and destination to be set first.",
      inputSchema: {
        type: "object",
        properties: {
          pickup: {
            type: "string",
            description: "Override pickup address (optional, uses stored pickup if not provided)",
          },
          destination: {
            type: "string",
            description: "Override destination address (optional, uses stored destination if not provided)",
          },
          headless: {
            type: "boolean",
            description: "Run browser in headless mode (default: true)",
          },
        },
      },
    },
    {
      name: "get_ride_options",
      description:
        "Get available ride types (UberX, Comfort, XL, Black, etc.) with pricing and ETAs for the current route.",
      inputSchema: {
        type: "object",
        properties: {
          pickup: {
            type: "string",
            description: "Override pickup address (optional)",
          },
          destination: {
            type: "string",
            description: "Override destination address (optional)",
          },
          headless: {
            type: "boolean",
            description: "Run browser in headless mode (default: true)",
          },
        },
      },
    },
    {
      name: "request_ride",
      description:
        "Request an Uber ride. Returns a confirmation prompt — does NOT automatically confirm the ride. Requires login and pickup/destination to be set.",
      inputSchema: {
        type: "object",
        properties: {
          ride_type: {
            type: "string",
            description: "Ride type to request (e.g., 'UberX', 'Comfort', 'XL', 'Black'). Defaults to UberX.",
          },
          confirm: {
            type: "boolean",
            description: "Set true to actually confirm and place the ride request. Default false (preview only).",
          },
          headless: {
            type: "boolean",
            description: "Run browser in headless mode (default: true)",
          },
        },
      },
    },
    {
      name: "get_ride_status",
      description: "Get the status of your current or most recent Uber ride",
      inputSchema: {
        type: "object",
        properties: {
          headless: {
            type: "boolean",
            description: "Run browser in headless mode (default: true)",
          },
        },
      },
    },
    {
      name: "cancel_ride",
      description: "Cancel a pending or active Uber ride request",
      inputSchema: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            description: "Set true to confirm cancellation. Default false (shows cancellation info only).",
          },
          headless: {
            type: "boolean",
            description: "Run browser in headless mode (default: true)",
          },
        },
      },
    },
    {
      name: "get_ride_history",
      description: "Get recent Uber ride history",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of recent trips to return (default: 10)",
          },
          headless: {
            type: "boolean",
            description: "Run browser in headless mode (default: true)",
          },
        },
      },
    },
  ],
}));

// ─── Tool handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "status":
        return await handleStatus();
      case "login":
        return await handleLogin(
          a.identifier as string,
          a.password as string,
          a.headless !== false
        );
      case "logout":
        return await handleLogout();
      case "set_pickup":
        return await handleSetPickup(a.address as string);
      case "set_destination":
        return await handleSetDestination(a.address as string);
      case "get_fare_estimate":
        return await handleGetFareEstimate(
          a.pickup as string | undefined,
          a.destination as string | undefined,
          a.headless !== false
        );
      case "get_ride_options":
        return await handleGetRideOptions(
          a.pickup as string | undefined,
          a.destination as string | undefined,
          a.headless !== false
        );
      case "request_ride":
        return await handleRequestRide(
          (a.ride_type as string | undefined) ?? "UberX",
          a.confirm === true,
          a.headless !== false
        );
      case "get_ride_status":
        return await handleGetRideStatus(a.headless !== false);
      case "cancel_ride":
        return await handleCancelRide(a.confirm === true, a.headless !== false);
      case "get_ride_history":
        return await handleGetRideHistory(
          (a.limit as number | undefined) ?? 10,
          a.headless !== false
        );
      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Tool '${name}' failed: ${msg}`);
  }
});

// ─── Handler implementations ───────────────────────────────────────────────────

async function handleStatus() {
  const loggedIn = isLoggedIn();
  const auth = loadAuth();
  const route = loadRoute();

  if (!loggedIn) {
    return ok(
      "Not logged in. Use the `login` tool to authenticate with your Uber account."
    );
  }

  const lines = [
    `Logged in as: ${auth?.identifier ?? "unknown"}`,
    `Name: ${auth?.name ?? "unknown"}`,
    `Session established: ${auth?.loggedInAt ?? "unknown"}`,
  ];

  if (route?.pickup || route?.destination) {
    lines.push("");
    lines.push("Current route:");
    if (route.pickup) lines.push(`  Pickup: ${route.pickup}`);
    if (route.destination) lines.push(`  Destination: ${route.destination}`);
  } else {
    lines.push("\nNo route set. Use `set_pickup` and `set_destination` to plan a ride.");
  }

  return ok(lines.join("\n"));
}

async function handleLogin(
  identifier: string,
  password: string,
  headless: boolean
) {
  if (!identifier || !password) {
    return err("identifier (email or phone) and password are required");
  }

  return withPage(async (page: Page) => {
    // Navigate to Uber login
    await page.goto("https://auth.uber.com/v2/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    // Check if already logged in by trying riders.uber.com
    const currentUrl = page.url();
    if (
      currentUrl.includes("riders.uber.com") &&
      !currentUrl.includes("login") &&
      !currentUrl.includes("auth")
    ) {
      const auth = loadAuth();
      if (auth) {
        return ok(`Already logged in as ${auth.name ?? auth.identifier}`);
      }
    }

    // Enter email/phone
    const identifierInput = await page.waitForSelector(
      'input[name="userNameInputField"], input[placeholder*="Email"], input[placeholder*="Phone"], input[type="email"], input[type="tel"]',
      { timeout: 15000 }
    );
    await identifierInput.click();
    await identifierInput.fill(identifier);

    // Click Next / Continue
    const nextBtn = await page.waitForSelector(
      'button[type="submit"], [data-baseweb="button"]:has-text("Next"), [data-baseweb="button"]:has-text("Continue")',
      { timeout: 10000 }
    );
    await nextBtn.click();
    await page.waitForTimeout(2000);

    // Check for OTP screen
    const otpInput = await page.$(
      'input[name="verificationCode"], input[placeholder*="code"], input[placeholder*="OTP"]'
    );
    if (otpInput) {
      return err(
        "OTP verification required. Please run login with headless=false to complete the verification manually, then call login again."
      );
    }

    // Enter password
    const passwordInput = await page.waitForSelector(
      'input[name="password"], input[type="password"]',
      { timeout: 10000 }
    );
    await passwordInput.click();
    await passwordInput.fill(password);

    // Submit
    const submitBtn = await page.waitForSelector(
      'button[type="submit"], [data-baseweb="button"]:has-text("Sign in"), [data-baseweb="button"]:has-text("Log in")',
      { timeout: 5000 }
    );
    await submitBtn.click();
    await page.waitForTimeout(4000);

    // Check for errors
    const errorEl = await page.$(
      '[data-baseweb="notification"], [class*="error"], [class*="Error"], [role="alert"]'
    );
    if (errorEl) {
      const errorText = await errorEl.textContent();
      if (errorText && errorText.trim().length > 0 && errorText.length < 200) {
        return err(`Login failed: ${errorText.trim()}`);
      }
    }

    // Detect if still on auth page
    const postUrl = page.url();
    if (postUrl.includes("auth.uber.com") || postUrl.includes("/login")) {
      // Could be OTP or captcha
      return err(
        "Login may have failed or requires additional verification. Try with headless=false to see what's happening."
      );
    }

    // Try to get name from the page
    let name: string | undefined;
    try {
      await page.goto("https://riders.uber.com/", {
        waitUntil: "domcontentloaded",
        timeout: 20000,
      });
      await page.waitForTimeout(2000);

      const nameEl = await page.$(
        '[data-testid="user-name"], [class*="UserName"], [class*="firstName"]'
      );
      if (nameEl) name = (await nameEl.textContent())?.trim();
    } catch {
      // Ignore
    }

    await saveSessionCookies();
    saveAuth({ identifier, loggedInAt: new Date().toISOString(), name });

    return ok(`Successfully logged in${name ? ` as ${name}` : ""} (${identifier})`);
  }, headless);
}

async function handleLogout() {
  clearCookies();
  clearRoute();
  return ok("Logged out. Session cookies and route cleared.");
}

async function handleSetPickup(address: string) {
  if (!address) return err("address is required");
  saveRoute({ pickup: address });
  return ok(`Pickup set to: ${address}`);
}

async function handleSetDestination(address: string) {
  if (!address) return err("address is required");
  saveRoute({ destination: address });
  return ok(`Destination set to: ${address}`);
}

async function handleGetFareEstimate(
  pickupOverride?: string,
  destinationOverride?: string,
  headless = true
) {
  const route = loadRoute() ?? {};
  const pickup = pickupOverride ?? route.pickup;
  const destination = destinationOverride ?? route.destination;

  if (!pickup) {
    return err(
      "No pickup location set. Use `set_pickup` first or provide pickup parameter."
    );
  }
  if (!destination) {
    return err(
      "No destination set. Use `set_destination` first or provide destination parameter."
    );
  }

  return withPage(async (page: Page) => {
    await page.goto("https://www.uber.com/global/en/price-estimate/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    // Enter pickup
    const pickupInput = await page.waitForSelector(
      'input[placeholder*="Pickup"], input[placeholder*="pickup"], input[name="pickup"], input[aria-label*="Pickup"]',
      { timeout: 15000 }
    );
    await pickupInput.click();
    await pickupInput.fill(pickup);
    await page.waitForTimeout(1500);

    // Select first suggestion
    const pickupSuggestion = await page.$(
      '[data-testid="suggestion"], [role="option"], [class*="suggestion"], li[class*="result"]'
    );
    if (pickupSuggestion) {
      await pickupSuggestion.click();
      await page.waitForTimeout(1000);
    } else {
      await pickupInput.press("Enter");
      await page.waitForTimeout(1000);
    }

    // Enter destination
    const destInput = await page.waitForSelector(
      'input[placeholder*="Dropoff"], input[placeholder*="destination"], input[name="destination"], input[aria-label*="Dropoff"]',
      { timeout: 10000 }
    );
    await destInput.click();
    await destInput.fill(destination);
    await page.waitForTimeout(1500);

    // Select first suggestion
    const destSuggestion = await page.$(
      '[data-testid="suggestion"], [role="option"], [class*="suggestion"], li[class*="result"]'
    );
    if (destSuggestion) {
      await destSuggestion.click();
      await page.waitForTimeout(1000);
    } else {
      await destInput.press("Enter");
      await page.waitForTimeout(1000);
    }

    // Wait for fare estimates to load
    await page.waitForTimeout(3000);

    // Scrape fare options
    const fares = await page.evaluate(() => {
      // Try multiple selector patterns for fare cards
      const fareEls = Array.from(
        document.querySelectorAll(
          '[data-testid*="product"], [class*="ProductSelector"], [class*="RideOption"], [class*="fare"], [class*="product-card"]'
        )
      );

      if (fareEls.length === 0) {
        // Fallback: look for any price-containing rows
        const priceEls = Array.from(document.querySelectorAll('[class*="Price"], [class*="price"]'));
        return priceEls.slice(0, 8).map((el) => ({
          type: "Unknown",
          price: el.textContent?.trim() ?? "",
          eta: "",
          description: "",
        }));
      }

      return fareEls.slice(0, 8).map((el) => {
        const type =
          el.querySelector('[class*="productName"], [class*="ProductName"], h3, h4')
            ?.textContent?.trim() ?? "";
        const price =
          el.querySelector('[class*="price"], [class*="Price"], [class*="fare"]')
            ?.textContent?.trim() ?? "";
        const eta =
          el.querySelector('[class*="eta"], [class*="ETA"], [class*="time"]')
            ?.textContent?.trim() ?? "";
        const description =
          el.querySelector('[class*="description"], [class*="Description"], p')
            ?.textContent?.trim() ?? "";

        return { type, price, eta, description };
      });
    });

    // Also try to get page text if no structured data
    if (fares.length === 0 || fares.every((f) => !f.type && !f.price)) {
      const pageText = await page.evaluate(() => {
        const main = document.querySelector("main, [role='main'], #app");
        return main?.textContent?.trim().slice(0, 1000) ?? "";
      });
      return ok(
        `Fare estimate page loaded for route:\n  From: ${pickup}\n  To: ${destination}\n\nPage content:\n${pageText}\n\nURL: ${page.url()}`
      );
    }

    const lines = [
      `**Fare Estimates**`,
      `From: ${pickup}`,
      `To: ${destination}\n`,
    ];

    fares.forEach((f, i) => {
      if (f.type || f.price) {
        lines.push(
          `${i + 1}. ${f.type || "Option"}\n` +
          `   Price: ${f.price || "N/A"}\n` +
          (f.eta ? `   ETA: ${f.eta}\n` : "") +
          (f.description ? `   ${f.description}\n` : "")
        );
      }
    });

    return ok(lines.join("\n"));
  }, headless);
}

async function handleGetRideOptions(
  pickupOverride?: string,
  destinationOverride?: string,
  headless = true
) {
  // get_ride_options uses the same flow as get_fare_estimate
  // but focuses on ride types. Reuse the fare estimate logic.
  return handleGetFareEstimate(pickupOverride, destinationOverride, headless);
}

async function handleRequestRide(
  rideType = "UberX",
  confirm = false,
  headless = true
) {
  if (!isLoggedIn()) {
    return err("Not logged in. Use the `login` tool first.");
  }

  const route = loadRoute() ?? {};
  const pickup = route.pickup;
  const destination = route.destination;

  if (!pickup) {
    return err("No pickup location set. Use `set_pickup` first.");
  }
  if (!destination) {
    return err("No destination set. Use `set_destination` first.");
  }

  if (!confirm) {
    return ok(
      `**Ride Request Preview**\n\n` +
      `Ride type: ${rideType}\n` +
      `From: ${pickup}\n` +
      `To: ${destination}\n\n` +
      `Call \`request_ride\` with \`confirm: true\` to place this ride request.\n` +
      `Note: A cancellation fee may apply if you cancel after a driver accepts.`
    );
  }

  return withPage(async (page: Page) => {
    // Navigate to riders app
    await page.goto("https://riders.uber.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    // Enter pickup location
    const pickupInput = await page.waitForSelector(
      'input[placeholder*="Pickup"], input[placeholder*="Where are you"], input[aria-label*="pickup"]',
      { timeout: 15000 }
    );
    await pickupInput.click();
    await pickupInput.fill(pickup);
    await page.waitForTimeout(1500);

    const pickupSuggestion = await page.$(
      '[data-testid="suggestion"], [role="option"], [class*="suggestion"]'
    );
    if (pickupSuggestion) {
      await pickupSuggestion.click();
    } else {
      await pickupInput.press("Enter");
    }
    await page.waitForTimeout(1000);

    // Enter destination
    const destInput = await page.waitForSelector(
      'input[placeholder*="Where to"], input[placeholder*="Dropoff"], input[aria-label*="destination"]',
      { timeout: 10000 }
    );
    await destInput.click();
    await destInput.fill(destination);
    await page.waitForTimeout(1500);

    const destSuggestion = await page.$(
      '[data-testid="suggestion"], [role="option"], [class*="suggestion"]'
    );
    if (destSuggestion) {
      await destSuggestion.click();
    } else {
      await destInput.press("Enter");
    }
    await page.waitForTimeout(3000);

    // Select ride type
    try {
      const rideTypeEls = await page.$$(
        '[data-testid*="product"], [class*="ProductSelector"], [class*="RideOption"]'
      );
      for (const el of rideTypeEls) {
        const text = await el.textContent();
        if (text?.toLowerCase().includes(rideType.toLowerCase())) {
          await el.click();
          await page.waitForTimeout(1000);
          break;
        }
      }
    } catch {
      // Continue with default selection
    }

    // Get fare info before confirming
    const fareInfo = await page.evaluate(() => {
      const priceEl = document.querySelector(
        '[class*="fare"], [class*="Price"], [class*="price"], [data-testid*="price"]'
      );
      const etaEl = document.querySelector('[class*="eta"], [class*="ETA"], [class*="time"]');
      return {
        price: priceEl?.textContent?.trim() ?? "unknown",
        eta: etaEl?.textContent?.trim() ?? "unknown",
      };
    });

    // Click Request / Confirm button
    const requestBtn = await page.$(
      'button:has-text("Request"), button:has-text("Confirm"), [data-testid="request-button"], [class*="RequestButton"]'
    );

    if (!requestBtn) {
      return ok(
        `**Ride Request Setup**\n\n` +
        `Ride type: ${rideType}\n` +
        `From: ${pickup}\n` +
        `To: ${destination}\n` +
        `Estimated fare: ${fareInfo.price}\n` +
        `ETA: ${fareInfo.eta}\n\n` +
        `Could not locate the confirm button automatically. ` +
        `Please run with headless=false to complete the request manually.\n` +
        `URL: ${page.url()}`
      );
    }

    await requestBtn.click();
    await page.waitForTimeout(4000);

    const postUrl = page.url();
    return ok(
      `**Ride Requested!**\n\n` +
      `Ride type: ${rideType}\n` +
      `From: ${pickup}\n` +
      `To: ${destination}\n` +
      `Estimated fare: ${fareInfo.price}\n` +
      `ETA: ${fareInfo.eta}\n\n` +
      `Use \`get_ride_status\` to track your driver.\n` +
      `URL: ${postUrl}`
    );
  }, headless);
}

async function handleGetRideStatus(headless = true) {
  if (!isLoggedIn()) {
    return err("Not logged in. Use the `login` tool first.");
  }

  return withPage(async (page: Page) => {
    await page.goto("https://riders.uber.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    const status = await page.evaluate(() => {
      // Look for active ride indicators
      const activeRideEl = document.querySelector(
        '[data-testid="active-trip"], [class*="ActiveTrip"], [class*="TripStatus"], [class*="tripStatus"]'
      );

      const driverEl = document.querySelector(
        '[class*="DriverName"], [data-testid="driver-name"], [class*="driverInfo"]'
      );

      const etaEl = document.querySelector(
        '[class*="eta"], [class*="ETA"], [class*="ArrivalTime"], [data-testid="eta"]'
      );

      const statusEl = document.querySelector(
        '[class*="statusMessage"], [class*="StatusMessage"], [class*="tripPhase"], [data-testid="trip-status"]'
      );

      const vehicleEl = document.querySelector(
        '[class*="vehicleInfo"], [class*="VehicleInfo"], [data-testid="vehicle"]'
      );

      return {
        hasActiveRide: !!activeRideEl,
        driver: driverEl?.textContent?.trim() ?? "",
        eta: etaEl?.textContent?.trim() ?? "",
        statusMessage: statusEl?.textContent?.trim() ?? "",
        vehicle: vehicleEl?.textContent?.trim() ?? "",
        pageSnippet: document.body.textContent?.slice(0, 500) ?? "",
      };
    });

    if (!status.hasActiveRide && !status.driver && !status.statusMessage) {
      return ok("No active ride found. You may not have a current trip in progress.");
    }

    const lines = ["**Current Ride Status**\n"];
    if (status.statusMessage) lines.push(`Status: ${status.statusMessage}`);
    if (status.driver) lines.push(`Driver: ${status.driver}`);
    if (status.vehicle) lines.push(`Vehicle: ${status.vehicle}`);
    if (status.eta) lines.push(`ETA: ${status.eta}`);
    lines.push(`\nURL: ${page.url()}`);

    return ok(lines.join("\n"));
  }, headless);
}

async function handleCancelRide(confirm = false, headless = true) {
  if (!isLoggedIn()) {
    return err("Not logged in. Use the `login` tool first.");
  }

  if (!confirm) {
    return ok(
      `**Cancel Ride**\n\n` +
      `This will cancel your current pending or active ride request.\n` +
      `Note: A cancellation fee may apply if a driver has already been assigned.\n\n` +
      `Call \`cancel_ride\` with \`confirm: true\` to proceed with cancellation.`
    );
  }

  return withPage(async (page: Page) => {
    await page.goto("https://riders.uber.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Look for cancel button
    const cancelBtn = await page.$(
      'button:has-text("Cancel"), [data-testid="cancel-button"], [class*="CancelButton"], [aria-label*="Cancel ride"]'
    );

    if (!cancelBtn) {
      return err(
        "No active ride to cancel, or the cancel button could not be located. " +
        "Try with headless=false to check the current state."
      );
    }

    await cancelBtn.click();
    await page.waitForTimeout(2000);

    // Handle confirmation dialog
    const confirmCancelBtn = await page.$(
      'button:has-text("Cancel ride"), button:has-text("Confirm cancel"), [data-testid="confirm-cancel"]'
    );
    if (confirmCancelBtn) {
      await confirmCancelBtn.click();
      await page.waitForTimeout(2000);
    }

    return ok(
      "Ride cancellation submitted.\n\n" +
      "Note: A cancellation fee may have been applied if a driver had been assigned. " +
      "Check the Uber app or your email for confirmation."
    );
  }, headless);
}

async function handleGetRideHistory(limit = 10, headless = true) {
  if (!isLoggedIn()) {
    return err("Not logged in. Use the `login` tool first.");
  }

  return withPage(async (page: Page) => {
    await page.goto("https://riders.uber.com/trips", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    try {
      await page.waitForSelector(
        '[data-testid="trip-card"], [class*="TripCard"], [class*="tripCard"], [class*="HistoryItem"]',
        { timeout: 15000 }
      );
    } catch {
      // Page may have loaded differently — try to get whatever content is there
      const pageText = await page.evaluate(() => {
        const main = document.querySelector("main, [role='main'], #app");
        return main?.textContent?.trim().slice(0, 1500) ?? "";
      });

      if (pageText) {
        return ok(`Ride history page content:\n\n${pageText}`);
      }
      return err("Failed to load ride history. Make sure you are logged in.");
    }

    const trips = await page.evaluate((limit: number) => {
      const tripEls = Array.from(
        document.querySelectorAll(
          '[data-testid="trip-card"], [class*="TripCard"], [class*="tripCard"], [class*="HistoryItem"], [class*="trip-list"] li'
        )
      ).slice(0, limit);

      return tripEls.map((el) => {
        const date =
          el.querySelector('[class*="date"], [class*="Date"], time')
            ?.textContent?.trim() ?? "";
        const pickup =
          el.querySelector('[class*="pickup"], [class*="Pickup"], [data-testid="pickup"]')
            ?.textContent?.trim() ?? "";
        const destination =
          el.querySelector('[class*="destination"], [class*="Destination"], [data-testid="destination"]')
            ?.textContent?.trim() ?? "";
        const fare =
          el.querySelector('[class*="fare"], [class*="Fare"], [class*="price"], [class*="Price"]')
            ?.textContent?.trim() ?? "";
        const rideType =
          el.querySelector('[class*="productName"], [class*="ProductName"], [class*="rideType"]')
            ?.textContent?.trim() ?? "";
        const status =
          el.querySelector('[class*="status"], [class*="Status"]')
            ?.textContent?.trim() ?? "";

        // Fallback to full card text
        const fullText = el.textContent?.trim().slice(0, 200) ?? "";

        return { date, pickup, destination, fare, rideType, status, fullText };
      });
    }, limit);

    if (trips.length === 0) {
      return ok("No ride history found.");
    }

    const lines = [`**Ride History (${trips.length} trip${trips.length !== 1 ? "s" : ""})**\n`];
    trips.forEach((trip, i) => {
      if (trip.date || trip.pickup || trip.destination || trip.fare) {
        lines.push(
          `${i + 1}. ${trip.date || "Date N/A"}\n` +
          (trip.rideType ? `   Type: ${trip.rideType}\n` : "") +
          (trip.pickup ? `   From: ${trip.pickup}\n` : "") +
          (trip.destination ? `   To: ${trip.destination}\n` : "") +
          (trip.fare ? `   Fare: ${trip.fare}\n` : "") +
          (trip.status ? `   Status: ${trip.status}\n` : "")
        );
      } else if (trip.fullText) {
        lines.push(`${i + 1}. ${trip.fullText}\n`);
      }
    });

    return ok(lines.join("\n"));
  }, headless);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(text: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${text}` }],
    isError: true,
  };
}

// ─── Start server ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("Uber MCP server running on stdio\n");
}

main().catch((e) => {
  process.stderr.write(`Fatal: ${e}\n`);
  process.exit(1);
});

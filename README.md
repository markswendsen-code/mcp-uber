# @striderlabs/mcp-uber

MCP server connector for Uber ride-sharing — request rides, get fare estimates, and track trips via browser automation.

## Installation

```bash
npx @striderlabs/mcp-uber
```

Or install globally:

```bash
npm install -g @striderlabs/mcp-uber
```

## MCP Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "uber": {
      "command": "npx",
      "args": ["@striderlabs/mcp-uber"]
    }
  }
}
```

## Tools

### `status`

Check Uber authentication and session status, including the current pickup/destination if set.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| _(no parameters)_ | | | |

---

### `login`

Authenticate with Uber using email/phone and password via browser automation.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `identifier` | string | Yes | Uber account email address or phone number |
| `password` | string | Yes | Uber account password |
| `headless` | boolean | No | Run browser in headless mode (default: `true`). Set `false` to see the browser and complete OTP/captcha manually. |

> **Note:** Uber often requires phone OTP verification. If OTP is triggered, run with `headless: false` to complete verification in the visible browser window, then call `login` again.

---

### `logout`

Clear the Uber session and all stored cookies.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| _(no parameters)_ | | | |

---

### `set_pickup`

Set the pickup location for a ride request. Persists across tool calls.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `address` | string | Yes | Pickup address (e.g., `"123 Main St, New York, NY"` or `"JFK Airport"`) |

---

### `set_destination`

Set the destination for a ride request. Persists across tool calls.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `address` | string | Yes | Destination address (e.g., `"456 Park Ave, New York, NY"` or `"LaGuardia Airport"`) |

---

### `get_fare_estimate`

Get fare estimates for all available ride types between pickup and destination.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pickup` | string | No | Override pickup address (uses stored pickup if not provided) |
| `destination` | string | No | Override destination address (uses stored destination if not provided) |
| `headless` | boolean | No | Run browser in headless mode (default: `true`) |

> **Note:** Set pickup and destination first with `set_pickup` / `set_destination`, or provide them directly as parameters.

---

### `get_ride_options`

Get available ride types (UberX, Comfort, XL, Black, etc.) with pricing and ETAs for the current route.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `pickup` | string | No | Override pickup address |
| `destination` | string | No | Override destination address |
| `headless` | boolean | No | Run browser in headless mode (default: `true`) |

---

### `request_ride`

Request an Uber ride. Returns a confirmation preview by default — does **not** automatically confirm.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `ride_type` | string | No | Ride type (e.g., `"UberX"`, `"Comfort"`, `"XL"`, `"Black"`). Defaults to `"UberX"`. |
| `confirm` | boolean | No | Set `true` to actually place the ride request. Default `false` (preview only). |
| `headless` | boolean | No | Run browser in headless mode (default: `true`) |

> **Warning:** Setting `confirm: true` will attempt to place a real ride request. Make sure pickup, destination, and ride type are correct before confirming.

---

### `get_ride_status`

Get the status of your current or most recent Uber ride.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `headless` | boolean | No | Run browser in headless mode (default: `true`) |

---

### `cancel_ride`

Cancel a pending or active Uber ride request.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `confirm` | boolean | No | Set `true` to confirm cancellation. Default `false` (shows cancellation info only). |
| `headless` | boolean | No | Run browser in headless mode (default: `true`) |

> **Note:** A cancellation fee may apply if a driver has already been assigned. Review the cancellation policy before confirming.

---

### `get_ride_history`

Get recent Uber ride history.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `limit` | number | No | Number of recent trips to return (default: `10`) |
| `headless` | boolean | No | Run browser in headless mode (default: `true`) |

---

## Typical Workflow

```
1. login          → Authenticate with Uber
2. set_pickup     → "Times Square, New York, NY"
3. set_destination → "JFK Airport, Queens, NY"
4. get_fare_estimate → Review prices for UberX, Comfort, XL, etc.
5. request_ride   → Preview the ride (confirm: false)
6. request_ride   → confirm: true to place the request
7. get_ride_status → Track your driver
8. cancel_ride    → Cancel if needed (confirm: true)
```

## Session Storage

Sessions and route data are stored in:

```
~/.striderlabs/uber/
├── cookies.json   # Browser session cookies
├── auth.json      # Account metadata
└── route.json     # Current pickup/destination
```

## Technical Details

- **Transport:** stdio (MCP standard)
- **Browser:** Chromium via Playwright with stealth patches
- **Stealth:** Patches `navigator.webdriver`, spoof plugins/languages, remove automation markers
- **Geolocation:** Defaults to New York City (40.7128, -74.006)
- **User Agent:** Chrome 120 on macOS

## Notes

- **OTP/Captcha:** Uber may require phone OTP or CAPTCHA during login. Use `headless: false` to handle these manually.
- **Fare Estimates:** Available without login via uber.com/global/en/price-estimate/
- **Ride Requests:** Require an active logged-in session.
- **Cancellation Fees:** Uber may charge a fee if you cancel after a driver is assigned.
- **Mobile App:** Uber is primarily a mobile app. The web interface (riders.uber.com) is used for automation, which may have different features than the mobile app.

## License

MIT — [Strider Labs](https://striderlabs.ai)

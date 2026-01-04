#!/usr/bin/env python3
"""
AI-driven login automation using browser-use and Claude.

This script uses browser-use with Claude AI to perform human-like login
operations on vendor portals, including handling reCAPTCHA challenges.

Usage:
    python ai_login.py --vendor ibj --login-url https://example.com/login

Environment Variables:
    ANTHROPIC_API_KEY: Anthropic API key for Claude
    IBJ_USERNAME: Username for IBJ login
    IBJ_PASSWORD: Password for IBJ login

Output:
    JSON to stdout with login result:
    {
        "success": true/false,
        "cookies": [...],  // if success
        "error": "...",    // if failure
        "screenshots": [...] // base64 encoded debug screenshots
    }
"""
import argparse
import asyncio
import base64
import json
import os
import sys
from typing import Any

# browser-use imports (v0.11.2+)
from browser_use import Agent, Browser
from browser_use.llm.anthropic.chat import ChatAnthropic


class AILoginResult:
    """Result of AI login attempt."""

    def __init__(
        self,
        success: bool,
        cookies: list[dict[str, Any]] | None = None,
        error: str | None = None,
        screenshots: list[str] | None = None,
    ):
        self.success = success
        self.cookies = cookies or []
        self.error = error
        self.screenshots = screenshots or []

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"success": self.success}
        if self.success:
            result["cookies"] = self.cookies
        else:
            result["error"] = self.error
        if self.screenshots:
            result["screenshots"] = self.screenshots
        return result


def get_ibj_login_task(username: str, password: str, login_url: str) -> str:
    """Generate the task prompt for IBJ login."""
    return f"""
Navigate to {login_url} and perform login with the following steps.
Be patient and wait for elements to load before interacting.

IMPORTANT: Act like a human user. Move naturally, wait between actions.

Steps:
1. Wait for the login page to fully load (look for the login form)

2. Find the user ID input field (look for input with id "login_user_cd" or
   label containing "ユーザーID" or "ログインID")
   - Click on it first
   - Then type the username: {username}
   - Type naturally with small pauses between characters

3. Find the password input field (look for input with id "login_password" or
   type="password")
   - Click on it first
   - Then type the password: {password}
   - Type naturally with small pauses

4. Look for a reCAPTCHA checkbox (iframe containing "recaptcha" or checkbox
   with text like "I'm not a robot" / "私はロボットではありません")
   - If found, click the checkbox
   - Wait to see if an image challenge appears
   - If image challenge appears, solve it by selecting the correct images

5. Find and click the login button (look for green button with text "ログイン"
   or input/button with value="ログイン")

6. Wait for the page to navigate away from the login page
   - Success indicators: URL changes from /logins, or you see elements like
     "マイページ", user name display, or OTP input page

7. If you see an OTP/verification code page, that means login was successful
   - Report success - the OTP will be handled separately

Report your progress and any errors encountered.
If login fails (wrong credentials, CAPTCHA failure), report the error message.
"""


async def perform_login(
    vendor: str,
    login_url: str,
    username: str,
    password: str,
    headless: bool = True,
) -> AILoginResult:
    """
    Perform AI-driven login using browser-use.

    Args:
        vendor: Vendor key (e.g., 'ibj')
        login_url: URL to navigate for login
        username: Login username
        password: Login password
        headless: Run browser in headless mode

    Returns:
        AILoginResult with success status, cookies, or error
    """
    screenshots: list[str] = []

    # Validate credentials
    if not username or not password:
        return AILoginResult(
            success=False,
            error="Credentials not provided (IBJ_USERNAME or IBJ_PASSWORD missing)",
        )

    # Check for API key
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return AILoginResult(
            success=False, error="ANTHROPIC_API_KEY not set in environment"
        )

    try:
        # Initialize Claude LLM (browser-use's built-in Anthropic chat)
        llm = ChatAnthropic(
            model="claude-sonnet-4-20250514",
            api_key=api_key,
        )

        # Create browser instance with config
        browser = Browser(
            headless=headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-setuid-sandbox",
            ],
        )

        # Get the login task (password is included directly in the task)
        if vendor == "ibj":
            task = get_ibj_login_task(username, password, login_url)
        else:
            return AILoginResult(
                success=False, error=f"Unsupported vendor: {vendor}"
            )

        # Create agent
        agent = Agent(
            task=task,
            llm=llm,
            browser=browser,
        )

        # Run the agent
        history = await agent.run(max_steps=30)

        # Extract cookies from browser
        try:
            cookies_raw = await browser.cookies()
            cookies = [
                {
                    "name": c.name if hasattr(c, 'name') else c.get("name", ""),
                    "value": c.value if hasattr(c, 'value') else c.get("value", ""),
                    "domain": c.domain if hasattr(c, 'domain') else c.get("domain", ""),
                    "path": c.path if hasattr(c, 'path') else c.get("path", "/"),
                    "expires": c.expires if hasattr(c, 'expires') else c.get("expires", -1),
                    "httpOnly": c.httpOnly if hasattr(c, 'httpOnly') else c.get("httpOnly", False),
                    "secure": c.secure if hasattr(c, 'secure') else c.get("secure", False),
                    "sameSite": c.sameSite if hasattr(c, 'sameSite') else c.get("sameSite", "Lax"),
                }
                for c in cookies_raw
            ]
        except Exception:
            cookies = []

        # Take final screenshot
        try:
            screenshot_bytes = await browser.take_screenshot()
            if screenshot_bytes:
                screenshots.append(base64.b64encode(screenshot_bytes).decode("utf-8"))
        except Exception:
            pass  # Screenshot is optional

        # Check if login was successful based on agent history
        # Look for indicators in the final state
        final_url = ""
        try:
            final_url = await browser.get_current_page_url()
        except Exception:
            pass

        login_success = False
        if final_url and "/logins" not in final_url:
            login_success = True
        elif any(
            indicator in str(history)
            for indicator in ["OTP", "verification", "マイページ", "成功"]
        ):
            login_success = True

        # Stop browser
        await browser.stop()

        if login_success:
            return AILoginResult(
                success=True, cookies=cookies, screenshots=screenshots
            )
        else:
            return AILoginResult(
                success=False,
                error="Login did not complete successfully - still on login page",
                screenshots=screenshots,
            )

    except Exception as e:
        return AILoginResult(success=False, error=str(e), screenshots=screenshots)


def main() -> None:
    """Main entry point for CLI usage."""
    parser = argparse.ArgumentParser(
        description="AI Login Automation using browser-use"
    )
    parser.add_argument(
        "--vendor", required=True, help="Vendor key (e.g., ibj)"
    )
    parser.add_argument(
        "--login-url", required=True, help="Login page URL"
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        default=True,
        help="Run browser in headless mode (default: True)",
    )
    parser.add_argument(
        "--no-headless",
        action="store_true",
        help="Run browser in visible mode (for debugging)",
    )

    args = parser.parse_args()

    # Get credentials from environment
    username = os.environ.get("IBJ_USERNAME", "")
    password = os.environ.get("IBJ_PASSWORD", "")

    # Determine headless mode
    headless = not args.no_headless

    # Run login
    result = asyncio.run(
        perform_login(
            vendor=args.vendor,
            login_url=args.login_url,
            username=username,
            password=password,
            headless=headless,
        )
    )

    # Output JSON result
    print(json.dumps(result.to_dict()))

    # Exit with appropriate code
    sys.exit(0 if result.success else 1)


if __name__ == "__main__":
    main()

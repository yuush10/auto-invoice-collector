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

# browser-use imports
from browser_use import Agent, Browser, BrowserConfig
from langchain_anthropic import ChatAnthropic


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


def get_ibj_login_task(username: str, login_url: str) -> str:
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
   - Then type the password (provided via environment variable)
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
        # Initialize Claude LLM
        llm = ChatAnthropic(
            model="claude-sonnet-4-20250514",
            temperature=0,
            max_tokens=4096,
            api_key=api_key,
        )

        # Configure browser
        browser_config = BrowserConfig(
            headless=headless,
            # Disable some automation detection
            extra_chromium_args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-setuid-sandbox",
            ],
        )

        # Create browser instance
        browser = Browser(config=browser_config)

        # Set password in environment for agent to use securely
        # (Agent instructions reference it without exposing in task text)
        os.environ["_AI_LOGIN_PASSWORD"] = password

        # Get the login task
        if vendor == "ibj":
            task = get_ibj_login_task(username, login_url)
        else:
            return AILoginResult(
                success=False, error=f"Unsupported vendor: {vendor}"
            )

        # Modify task to include password instruction
        task += """

IMPORTANT: For the password field, use the value from the _AI_LOGIN_PASSWORD
environment variable. Type it character by character with natural timing.
"""

        # Create agent
        agent = Agent(
            task=task,
            llm=llm,
            browser=browser,
        )

        # Run the agent
        history = await agent.run(max_steps=30)

        # Get browser context to extract cookies
        context = await browser.get_context()
        if context:
            cookies_raw = await context.cookies()
            cookies = [
                {
                    "name": c.get("name", ""),
                    "value": c.get("value", ""),
                    "domain": c.get("domain", ""),
                    "path": c.get("path", "/"),
                    "expires": c.get("expires", -1),
                    "httpOnly": c.get("httpOnly", False),
                    "secure": c.get("secure", False),
                    "sameSite": c.get("sameSite", "Lax"),
                }
                for c in cookies_raw
            ]

            # Take final screenshot
            page = await context.new_page() if not context.pages else context.pages[0]
            try:
                screenshot_bytes = await page.screenshot()
                screenshots.append(base64.b64encode(screenshot_bytes).decode("utf-8"))
            except Exception:
                pass  # Screenshot is optional

        else:
            cookies = []

        # Check if login was successful based on agent history
        # Look for indicators in the final state
        final_url = ""
        if context and context.pages:
            final_url = context.pages[0].url

        login_success = False
        if final_url and "/logins" not in final_url:
            login_success = True
        elif any(
            indicator in str(history)
            for indicator in ["OTP", "verification", "マイページ", "成功"]
        ):
            login_success = True

        # Close browser
        await browser.close()

        # Clean up password from environment
        os.environ.pop("_AI_LOGIN_PASSWORD", None)

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
        # Clean up password from environment on error
        os.environ.pop("_AI_LOGIN_PASSWORD", None)
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

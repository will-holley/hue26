# hue26

A minimal Phillips Hue CLI using [Ink](https://github.com/vadimdemedes/ink).

## Setup

1.  Discover Bridge IP

    ```bash
    curl https://discovery.meethue.com
    ```

    Returns JSON with your bridge IP:

    ```json
    [{ "id": "abc123", "internalipaddress": "192.168.1.100" }]
    ```

2.  Authenticate with your Bridge

    a. Press the physical link button on the Bridge.

    b. Send:

          ```http
          POST http://<bridge_ip>/api
          {"devicetype": "my_app#my_machine"}
          ```

    c. Bridge returns a `username` (API token).

3.  Set Environment Variables

    Create a `.env` file in the project root:

    ```
    cp .env.example .env
    ```

    Then set the `HUE_BRIDGE_IP` and `HUE_API_TOKEN` variables using the values from the previous steps.

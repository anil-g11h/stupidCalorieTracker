# Stupid Calorie Tracker

A straightforward calorie tracking application built with SvelteKit and Supabase, designed for simplicity and offline capability.

## Project Overview

The Stupid Calorie Tracker allows users to log their daily food intake and monitor their calorie consumption. It prioritizes a seamless user experience with offline support, ensuring that you can track your meals even without an internet connection. Data is synchronized with a Supabase backend when connectivity is restored.

Key Features:
-   **Effortless Logging:** Quickly add food items and calories.
-   **Offline-First:** Works without an internet connection using local storage.
-   **Data Synchronization:** Automatically syncs with the cloud when online.
-   **Recipe Management:** Create and manage custom recipes.
-   **Daily tracking:** View your daily progress at a glance.

## Setup Instructions

### 1. Install Dependencies

Clone the repository and install the necessary packages using npm:

```bash
npm install
```

### 2. Supabase Setup

This project uses Supabase as a backend. You need to set up a Supabase project and apply the database schema.

1.  Create a new project on [Supabase](https://supabase.com/).
2.  Navigate to the SQL Editor in your Supabase dashboard.
3.  Copy the contents of `supabase/schema.sql` and run it to create the necessary tables and policies.

### 3. Environment Variables

Configure the environment variables to connect your app to Supabase.

1.  Copy the example environment file:
    ```bash
    cp .env.example .env
    ```
2.  Open `.env` and fill in your Supabase credentials:
    ```env
    VITE_SUPABASE_URL=your_supabase_project_url
    VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
    ```
    You can find Supabase values in your Supabase project settings under **API**.

3.  Configure Gemini secrets in Supabase Edge Functions (server-side only):
    ```bash
    supabase secrets set GEMINI_API_KEY=your_gemini_api_key
    supabase secrets set GEMINI_MODEL=gemini-2.5-flash
    ```

4.  Deploy the function used by the app:
    ```bash
    supabase functions deploy gemini-food-nutrition
    ```

Do not expose Gemini keys in `VITE_*` variables for static hosting.

## Running the App

Start the development server:

```bash
npm run dev
```

Open your browser and navigate to `http://localhost:5173` (or the port shown in your terminal).

## Offline Features

The application is built with an "Offline-First" architecture. Here's how it works:

-   **Local Storage:** All data (foods, logs, recipes) is stored locally in the browser using IndexedDB (via Dexie.js). This ensures the app loads instantly and works completely offline.
-   **Sync Queue:** When you make changes while offline (e.g., adding a log), the operation is saved to a local synchronization queue.
-   **Automatic Sync:** The app listens for network connectivity. When the device comes back online, the `SyncManager` processes the queue, pushing local changes to Supabase and pulling any updates from the server.
-   **Conflict Resolution:** The system handles basic synchronization to keep the client and server in the same state.

## Future AI Integration

We plan to enhance the tracker with AI capabilities to make logging even easier:

-   **Natural Language Logging:** "I had a chicken sandwich and a coffee" -> Automatically parses and logs the items with estimated calories.
-   **Image Recognition:** Snap a photo of your meal to approximate calorie content.
-   **Smart Suggestions:** Predictive suggestions based on your eating habits and time of day.


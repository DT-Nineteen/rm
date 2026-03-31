# PA Dev Manager - Project Summary & Handover

## Project Overview
**PA Dev Manager** is a full-stack resource management application designed to track team member assignments across various projects. It features a real-time dashboard, a comprehensive monthly calendar view, and deep integration with Google Sheets for data synchronization.

## Key Features Implemented

### 1. Authentication & User Management
- **Google OAuth Integration:** Secure login using Firebase Authentication.
- **Role-Based Access Control (RBAC):** Supports 'Leader' (Admin) and 'Member' roles with different permission levels.
- **Profile Management:** Automatic profile creation and synchronization with Firestore.

### 2. Interactive Dashboards
- **Leader Dashboard:** Overview of all team members, active projects, and a comprehensive scheduling grid.
- **Member Dashboard:** Personalized view showing individual assignments and upcoming tasks.
- **Real-time Updates:** Powered by Firestore `onSnapshot` for instantaneous data synchronization across all clients.

### 3. Scheduling & Calendar
- **Monthly Calendar View:** A premium, interactive calendar showing AM/PM slots for each day.
- **Slot Management:** Ability to book, update, or delete project assignments for team members.
- **Visual Indicators:** Clear "Booked" vs. "Free" status with member initials and project names.

### 4. Project Management
- **CRUD Operations:** Leaders can create, view, and delete projects.
- **Assignment Logic:** Projects can be assigned to specific time slots for any team member.

### 5. Google Sheets Integration
- **Sidebar UI:** A custom Google Sheets sidebar that replicates the app's monthly calendar UI.
- **Data Synchronization:** Bi-directional sync between Firestore and Google Sheets.
- **Automated Setup:** Script to automatically configure the necessary sheet structure.

## Tech Stack
- **Frontend:** React 18, Vite, TypeScript.
- **Styling:** Tailwind CSS, Lucide React (Icons), Motion (Animations).
- **Backend/Database:** Firebase (Firestore, Authentication).
- **Integration:** Google Apps Script (GAS) for Google Sheets interaction.
- **Date Handling:** `date-fns`.

---

## How to Continue Development in Cursor

To continue "vibe coding" this project in Cursor, follow these steps:

### 1. Environment Setup
1.  **Clone the Repository:** Ensure you have the latest code from your source control.
2.  **Install Dependencies:**
    ```bash
    npm install
    ```
3.  **Configure Environment Variables:** Create a `.env` file in the root directory and add your Firebase configuration:
    ```env
    VITE_FIREBASE_API_KEY=your_api_key
    VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
    VITE_FIREBASE_PROJECT_ID=your_project_id
    VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
    VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
    VITE_FIREBASE_APP_ID=your_app_id
    ```
    *Note: Ensure these match the values in `firebase-applet-config.json`.*

### 2. Cursor Configuration
To get the best results from Cursor's AI (Composer/Chat), add a `.cursorrules` file to your project root with the following content:

```markdown
# PA Dev Manager Coding Rules

- **Tech Stack:** React, TypeScript, Tailwind CSS, Firebase Firestore.
- **Styling:** Use Tailwind utility classes. Prefer premium, clean aesthetics (rounded corners, subtle shadows, Inter font).
- **Icons:** Use `lucide-react`.
- **Animations:** Use `motion/react`.
- **Firebase:** 
    - Always use the modular SDK (v9+).
    - Use `onSnapshot` for real-time data.
    - Handle Firestore errors using the `handleFirestoreError` utility.
- **Google Sheets:** 
    - Sidebar code is located within `LeaderDashboard` in `App.tsx`.
    - GAS functions are in `sidebarCodeGS`.
    - Sidebar UI is in `sidebarHtml`.
- **Naming:** Use descriptive, camelCase names for variables and functions.
```

### 3. Continuing the "Vibe"
- **Context is Key:** When asking Cursor to make changes, reference specific components like `MonthlyCalendar`, `TimeSlotGrid`, or `ProjectManagement`.
- **UI Consistency:** Remind the AI to maintain the "premium" look and feel established in the current design.
- **GAS Updates:** If you modify the data structure in Firestore, remember to update the `getSheetData` and `sidebarHtml` logic to keep the Google Sheets sidebar in sync.

### 4. Running the Project
```bash
npm run dev
```
The app will be available at `http://localhost:3000`.

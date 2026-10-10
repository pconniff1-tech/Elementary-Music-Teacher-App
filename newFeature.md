# Feature Spec: Note Mode (Seating Chart)

## 1. Overview

Add a new **"Note Mode"** to the Seating Chart view. This mode allows teachers to quickly record and review qualitative observations for students while maintaining visual attendance data.

## 2. User Stories

- As a teacher, I want to switch to "Note Mode" to see specific interaction icons for each student.
- As a teacher, I want to write a quick note that is automatically tagged with the student's name, the academic year, and the **current date**.
- As a teacher, I want to view a chronological history of all notes for a specific student without leaving the seating chart.

## 3. Functional Requirements

### A. View Logic (Seating Chart)

- **Toggle Button:** Add a "Note Mode" button to the main mode switcher (alongside Attendance, Assessment, and Learning Sequence).
- **Student Card UI (Note Mode):**
  - Display student name.
  - **Pen Icon:** Triggers the "New Note" modal.
  - **Page Icon:** Triggers the "Note History" modal.
  - **Attendance Retention:** The card must keep the colored border/outline defined in Attendance Mode (e.g., Present, Absent, Tardy).

### B. New Note Modal & UI Style

- **Styling:** Inherit styles from the existing **Assessment Library**.
- **Input:** Use the standard **text box component** from the library for the note content.
- **Auto-tagging:** Automatically include `student_id`, `student_name`, `academic_year`, and `entry_date` (YYYY-MM-DD) in the payload.
- **Save Action:** Closes modal and clears local input state.

### C. Note History Modal

- **Styling:** Maintain consistency with the Assessment Library modal containers.
- **Running List:** Displays a vertical list of all notes for the selected student filtered by the current academic year.
- **Note Item Display:** Each note in the list should display its `entry_date` prominently.
- **Quick Add:** Include a text input (library style) and "Add" button at the bottom of the history list for rapid entry.

## 4. Data Requirements

- **Table/Collection:** `student_notes`
- **Fields:**
  - `id` (uuid)
  - `student_id` (foreign key)
  - `academic_year` (string/id)
  - `entry_date` (date/string) — _Used for filtering and display_
  - `content` (text)
  - `created_at` (timestamp) — _System generated_

## 5. Acceptance Criteria

- [ ] Switching to Note Mode replaces current assessment icons with Pen/Page icons.
- [ ] Saving a note successfully writes the **current date** to the database.
- [ ] Modals and text boxes perfectly match the **Assessment Library** visual style.
- [ ] History modal shows notes in chronological order with the date visible for each entry.
- [ ] Attendance outlines remain visible and accurate while in Note Mode.

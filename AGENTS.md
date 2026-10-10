# AGENTS.md

## Project Overview

- this is a stand alone app for windows. It uses Node.js, Electron, and Better SQLite3 for the database. Code is Javascript.
  Dependencies:
  better-sqlite3: ^12.8.0
  electron-updater: ^6.8.3
  eslint: ^9.39.4
  node-gyp: ^10.3.1
  tar: ^7.5.13
  DevDependencies:
  @electron/rebuild: ^4.0.3
  electron: ^41.0.4
  electron-builder: ^26.8.1
  App functions, work flow: 1. Elementary Music Teachers app for managing 700+ students. It sets up csv imported students by teacher. 2. 2. students are shown in two different views: Seating Chart View and Gradebook view 3. you select the class to view from the right side panel that houses the classes list, the seating charts list and the roster 4. actions and modes are found in the left side panel. actions are Chart Tools and manage students. 5. modes change what is shown on the student cards. 6. Attendance mode shows buttons for attendance taking on student cards, and cards are outlined with a color that reflects the attendance status, and recorded by date in the database. 7. Assessment mode shows a rating scale card on the seating chart and the student cards show numbers 1-4 for scoring. 7. Learing Sequence Mode shows an LSA prompt card and the student cards show E M and D for scoring. 8. The information gathered on the seating chart view can be viewed as a spreadsheet grid in gradebook view. changing a cell in gradebook view changes the selection in seating chart view. 9. in CHart tools there are arrange rows/circle buttons that organize students into a grid or into a super elipse shape by list order to fit within the center panel. The neaten row/circle buttons snap the student cards to the closest defined row or circle spot. 10. the seating chart panel gets its max size on open so when the window is resized the chart field doesn't change you just view a smaller part of the seating chart. There is also a function that looks at the system's screen scaling setting and compensates so it always renders as if the scaling is set to 100%. when viewing the seating area. you can also zoom in and out but return to 1-00% by clicking the button in the lower right of the center panel. 11. the manage students menu allows for adding student through a popup modal. edit students populates an edit button on each student card. clicking it opens the student record modal so you can edit information. 12. there is a button to import student from csv and export selected students to csv. 13. assessment mode has an assessment library to edit place holders for assessment rubrics. these are assinged to a gradelevel via a dropdown. 14. Learning Sequence mode has a lesson library that allows the user to import prompt images and also import an audio clip to each image imported. 15. in Learning sequence mode there is pen mode. when active a popup opens to allow hand written notes for an E M or D button that reaches the PLUS state. the written image is viewalbe in the gradebook view.

# Agent: Seating Chart Architect

# Role

You are an expert Electron and Node.js developer specializing in better-sqlite3 and geometric coordinate math. Your task is to implement a "Groups" engine for an elementary music teacher's seating chart app.

# Context

Database: SQLite (via better-sqlite3).
Scale: 700+ students, 30 classes.
Current State: The app already handles arrangeCircle and arrangeRows.
Goal: Add a Groups feature that calculates new (x, y) coordinates for students based on specific patterns without breaking existing math.

# Feature Specifications: Grouping Engine

## UI Requirements

Location: New "Groups" button under "Neaten Circle" in the Chart Tools menu.
Interaction: Opens a persistent Modal.
Controls:
Type: Squads (Vertical Columns), Stations (Clusters arranged around a circle), Self-space (Grid).
Constraint: Toggle between "Number of Groups" vs "Group Size" (dynamic input fields).
Sorting: Toggle between "Random" vs "Alphabetical (Last Name)".
Actions:
Create Groups: Runs math and updates UI (Modal stays open).
Done: Closes Modal.
Neaten Groups: A separate tool that uses greedy logic to snap cards to the group pattern.

## Geometry & Math Constraints

Zero Overlap: You must implement a collision-free placement algorithm.
Squads Logic: Divide students into N columns; distribute evenly.
Stations Logic: Group students into small clusters, then arrange those clusters in a large circle.
Self-space Logic: A uniform grid distribution across the entire available canvas.

# Technical Guidelines

Persistence: Every "Create Groups" action must trigger a bulk update to the SQLite database for the student positions.
Safety: Do NOT overwrite or delete arrangeCircle or arrangeRows.
Greedy Snapping: The Neaten Groups function must calculate the closest "ideal" slot for a card's current (x, y) and snap it there.
Cards in group clusters can be 2 pixels apart side to side and 2 pixels apart vertically based on attendance mode student card height. this tight group is then spaced around the specified pattern insuring no overlap of these tight group units.

# Definition of Done

User can create groups by size or count.
Students are sorted correctly before being placed.
Cards never overlap regardless of the number of students.
The "Neaten" tool correctly re-aligns manual adjustments.

# Modal Style

All Modals need to have the same styling for consistency: These include: groups modal, import from csv modal, Lesson Library modals, Assessment library modals, and any other modal or future modals.
Modal backround should be a pale tan color matching global theme
input fields should be white
buttons not bold with white back ground
assessment library case: background same as others, Rubric field back ground slightly darker than background and the input fields have white back ground. rating 1-4 input fields get colored outline styling per the rating scale colors. guide text for lesson subtitle not bold
delete buttons render as same red svg trash can
edit buttons should render as black svg pencil writing in a box.

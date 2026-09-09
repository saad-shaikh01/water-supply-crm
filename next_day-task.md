Vendor Dashboard – Task List

Please implement the following improvements and bug fixes one by one.

1. Improve Vehicle Selection UI (Start Day Meter Reading Modal)

On the Daily Sheet Details page:

/dashboard/daily-sheets/167dcea6-8fab-4528-8f32-d769c56074cc

Inside the Start Day Meter Reading modal, the vehicle selection currently only highlights the selected vehicle with a different color.

This is not a very clear selection pattern.

Expected Behavior

Update the vehicle selector so it behaves like a normal dropdown/select component:

Once a vehicle is selected, only the selected vehicle should be displayed in the field.
The user should immediately understand which vehicle is selected.
Do not keep showing all vehicle options after selection.
The UX should match the standard "selected option" behavior users expect from select inputs.
2. Display Full Vehicle Number Instead of Internal Code

On the Daily Sheet Details page:

/dashboard/daily-sheets/167dcea6-8fab-4528-8f32-d769c56074cc

Currently, the odometer section displays internal identifiers such as:

V2
V3

Instead, display the actual vehicle registration/vehicle number.

This change should be applied in both places:

Daily Sheet Details page (where odometer readings are shown)
Daily Sheet PDF (where the van/vehicle information is displayed)

Replace the internal code with the full vehicle number everywhere it is shown.

3. Investigate Acknowledgement Message Sent by Salesman

Currently, when a Salesman adds a communication, an Acknowledgement message is also being sent automatically.

This should not happen.

As far as I know, acknowledgement functionality is intended to be available only for the Admin role, not for Salesman or any other role.

Please investigate:

Why is the acknowledgement message being triggered?
Identify the root cause.
Fix the permission/logic so only the intended role can trigger acknowledgement messages.
4. Update Monthly Summary Section on Dashboard

Dashboard page:

/dashboard/overview

In the Monthly Summary (Last 6 Months) section, make the following changes.

Remove

Remove the Filled Received column completely.

Replace

Replace the Cash Expected column with a Revenue column.

Revenue should represent the actual sales revenue for that month.

Add Average Rate Column

Add a new column named Average Rate.

The average rate should represent the weighted average selling price per bottle.

Example:

Customer A → Rate = 180
Customer B → Rate = 200
Customer C → Rate = 220

The calculation should consider how many bottles were sold at each rate, producing the true average selling price per bottle for the month.

5. Investigate Cash Collected Value in Monthly Summary

In the same Monthly Summary section, the Cash Collected value does not appear to include payments recorded through the Record Payment feature.

Please investigate:

What data is currently being displayed in the Cash Collected column?
Which transactions are included?
Why are Record Payment transactions excluded (if they are)?
Determine whether this is a bug or an intentional design decision, and implement the correct behavior if needed.
6. Allow Crew Cash Editing on Closed Daily Sheets

On the Daily Sheet Details page:

/dashboard/daily-sheets/167dcea6-8fab-4528-8f32-d769c56074cc

Currently:

Expenses can still be edited even after the Daily Sheet has been closed.
However, Crew Cash is not editable once the sheet is closed.

Please make Crew Cash follow the same behavior as Expenses.

If Expenses are editable on closed sheets, Crew Cash should also remain editable under the same conditions.


7. hey transaction ma failed jinko ho rahe hein message un par b customer code customer name q display nh ho raha ha 

8. hey vendor-dashboard k customer list page ma /dashboard/customers yaha par payment name or code ma sorting feature added ha isi trha bottle balance wale column ma b sorting featuer add karo 

9. daily-sheet detail page ma /dashboard/daily-sheets/167dcea6-8fab-4528-8f32-d769c56074cc ma for now ik banner a jata ha jis me display hu raha huta ha k modified after close etc but exact puri detail nh milti kisne kia modify kia daily-sheet ma ik audit log ka button add karo jis par click karne par us specific sheet ki complete activeties ki audit report display hu kia kb edit huwa kitnay kis waqt kia etc a to z is it possible 

7. Show Customer Code and Customer Name for Failed Transactions

On the Transactions page, when a transaction has a Failed status, the Customer Code and Customer Name are currently not displayed.

Expected Behavior

Ensure that failed transactions display the same customer information as successful transactions.

Specifically:

Show the Customer Code.
Show the Customer Name.
The behavior should be consistent across all transaction statuses unless there is a deliberate business rule preventing it.

If the information is unavailable, investigate the root cause and fix the data flow so customer details are populated correctly for failed transactions.

8. Add Bottle Balance Sorting on Customer List

On the Customer List page:

/dashboard/customers

Sorting is already implemented for columns such as:

Customer Name
Customer Code

Implement the same sorting functionality for the Bottle Balance column.

Expected Behavior
Clicking the Bottle Balance column header should sort customers by their current bottle balance.
Support both ascending and descending sorting.
Follow the same sorting implementation and UX pattern already used by the existing sortable columns.
9. Add Daily Sheet Audit Log

On the Daily Sheet Details page:

/dashboard/daily-sheets/167dcea6-8fab-4528-8f32-d769c56074cc

Currently, after a Daily Sheet has been modified post-close, a banner is displayed indicating that the sheet was modified after closing.

However, the banner does not provide sufficient detail about what changed, who made the change, or when it happened.

Expected Behavior

Add an Audit Log button to the Daily Sheet Details page.

Clicking this button should open a complete audit history for that specific Daily Sheet.

The audit log should display, as comprehensively as possible:

Who performed each action.
What was changed.
Previous value → New value (where applicable).
Date and time of the change.
Type of action (Edit, Delete, Create, Correction, etc.).
The affected entity (Delivery, Expense, Crew Cash, Payment, Vehicle, etc.).
Any correction reason or note (if available).

The goal is to provide a complete A-to-Z activity history for a single Daily Sheet so an administrator can easily understand everything that has happened to it throughout its lifecycle.

Before implementing, first investigate what audit data is already being captured by the backend so the solution reuses existing audit infrastructure wherever possible instead of introducing duplicate logging.

10. daily-sheet ma customer sorting for now kis trha work karti ha like jb sheeet generate hoti ha to customer kis trha sort hote hein for now 
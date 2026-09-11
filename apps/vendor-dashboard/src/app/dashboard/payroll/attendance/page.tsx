'use client';

import { PageHeader } from '../../../../components/shared/page-header';
import { AttendanceGrid } from '../../../../features/payroll/components/attendance-grid';

export default function PayrollAttendancePage() {
  return (
    <div>
      <PageHeader
        title="Attendance"
        description="Per-employee daily attendance for the pay period. Rows auto-fill as daily-sheet crews are confirmed; click any cell to mark or correct a day."
      />
      <AttendanceGrid />
    </div>
  );
}

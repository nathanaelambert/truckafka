import { query, queryOne, pointToWKT } from '@truckmafia/shared';

// ── Update HOS when driver status changes ───────────────────────
// Implements a simplified version of Transport Canada HOS regulations

export async function updateDriverStatus(
  driverId: string,
  newStatus: 'off_duty' | 'on_duty_not_driving' | 'driving'
): Promise<void> {
  const driver = await queryOne<{ status: string }>(
    'SELECT status::text FROM driver WHERE id = $1',
    [driverId]
  );
  if (!driver) throw new Error('Driver not found');

  const oldStatus = driver.status;
  const now = new Date();

  // Log the status change
  await query(
    `INSERT INTO driver_status_log (driver_id, status, recorded_at) VALUES ($1, $2, $3)`,
    [driverId, newStatus, now]
  );

  await query('UPDATE driver SET status = $1 WHERE id = $2', [newStatus, driverId]);

  // Handle HOS transitions
  const hos = await queryOne<{
    remaining_cycle_h: number; remaining_on_duty_h: number; remaining_drive_h: number;
    next_bed_time: string | null; breaks_remaining: number; break_started: string | null;
    slept_today: boolean; shift_start: string | null;
  }>('SELECT * FROM hours_of_service WHERE driver_id = $1', [driverId]);

  if (!hos) {
    // Initialize HOS record
    await query(
      `INSERT INTO hours_of_service (driver_id, remaining_cycle_h, remaining_on_duty_h, remaining_drive_h, breaks_remaining, slept_today)
       VALUES ($1, 70, 14, 13, 4, false)`,
      [driverId]
    );
    return;
  }

  if (oldStatus === 'off_duty' && newStatus !== 'off_duty') {
    // Entering on-duty or driving
    const breakStart = hos.break_started ? new Date(hos.break_started) : null;
    let sleptToday = hos.slept_today;

    if (breakStart) {
      const breakDuration = (now.getTime() - breakStart.getTime()) / (1000 * 60 * 60); // hours
      if (breakDuration >= 8) {
        sleptToday = true;
        // Reset shift
        await query(
          `UPDATE hours_of_service SET
            shift_start = $1,
            next_bed_time = $2,
            remaining_on_duty_h = 14,
            remaining_drive_h = 13,
            breaks_remaining = 4,
            slept_today = true,
            break_started = NULL
           WHERE driver_id = $3`,
          [now, new Date(now.getTime() + 16 * 60 * 60 * 1000), driverId]
        );
        return;
      }
      // Short break — count 30-min breaks
      if (hos.breaks_remaining > 0 && breakDuration >= 0.5) {
        const numBreaks = Math.min(hos.breaks_remaining, Math.floor(breakDuration / 0.5));
        await query(
          `UPDATE hours_of_service SET
            breaks_remaining = breaks_remaining - $1,
            break_started = NULL
           WHERE driver_id = $2`,
          [numBreaks, driverId]
        );
      }
    }

    // New shift (or continuing)
    if (!hos.shift_start) {
      await query(
        `UPDATE hours_of_service SET shift_start = $1 WHERE driver_id = $2`,
        [now, driverId]
      );
    }
  }

  if (newStatus === 'off_duty') {
    // Record break start
    await query(
      `UPDATE hours_of_service SET break_started = $1 WHERE driver_id = $2`,
      [now, driverId]
    );
  }
}

// ── Tick: called periodically to decrement HOS ───────────────────

export async function tickHOS(driverId: string, deltaSeconds: number): Promise<void> {
  const driver = await queryOne<{ status: string }>('SELECT status::text FROM driver WHERE id = $1', [driverId]);
  if (!driver) return;

  const deltaHours = deltaSeconds / 3600;

  if (driver.status === 'driving') {
    await query(
      `UPDATE hours_of_service SET
        remaining_drive_h = GREATEST(remaining_drive_h - $1, 0),
        remaining_on_duty_h = GREATEST(remaining_on_duty_h - $1, 0),
        remaining_cycle_h = GREATEST(remaining_cycle_h - $1, 0),
        next_bed_time = next_bed_time + ($1 * interval '1 hour')
       WHERE driver_id = $2`,
      [deltaHours, driverId]
    );

    // Check violations
    const hos = await queryOne<{ remaining_drive_h: number; remaining_on_duty_h: number; remaining_cycle_h: number }>(
      'SELECT remaining_drive_h, remaining_on_duty_h, remaining_cycle_h FROM hours_of_service WHERE driver_id = $1',
      [driverId]
    );
    if (hos) {
      if (hos.remaining_drive_h <= 0 || hos.remaining_on_duty_h <= 0 || hos.remaining_cycle_h <= 0) {
        // Violation — notify via Kafka (the caller can check this)
        await query(
          `UPDATE driver SET status = 'on_duty_not_driving' WHERE id = $1 AND status = 'driving'`,
          [driverId]
        );
      }
    }
  } else if (driver.status === 'on_duty_not_driving') {
    await query(
      `UPDATE hours_of_service SET
        remaining_on_duty_h = GREATEST(remaining_on_duty_h - $1, 0),
        remaining_cycle_h = GREATEST(remaining_cycle_h - $1, 0),
        next_bed_time = next_bed_time + ($1 * interval '1 hour')
       WHERE driver_id = $2`,
      [deltaHours, driverId]
    );
  }
}

// ── Get HOS for a driver ────────────────────────────────────────

export async function getHOS(driverId: string) {
  return queryOne(
    `SELECT d.id AS driver_id, d.name, d.status::text AS driver_status,
        hos.remaining_cycle_h, hos.remaining_on_duty_h, hos.remaining_drive_h,
        hos.next_bed_time, hos.breaks_remaining, hos.slept_today,
        hos.shift_start, hos.break_started, hos.cycle_start
     FROM driver d
     LEFT JOIN hours_of_service hos ON hos.driver_id = d.id
     WHERE d.id = $1`,
    [driverId]
  );
}

// ── Get all drivers' HOS ────────────────────────────────────────

export async function getAllHOS() {
  return query(
    `SELECT d.id AS driver_id, d.name, d.status::text AS driver_status,
        hos.remaining_cycle_h, hos.remaining_on_duty_h, hos.remaining_drive_h,
        hos.next_bed_time, hos.breaks_remaining, hos.slept_today
     FROM driver d
     LEFT JOIN hours_of_service hos ON hos.driver_id = d.id
     ORDER BY d.name`
  );
}

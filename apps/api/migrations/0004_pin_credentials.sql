-- Existing non-admin credentials cannot be converted into PINs; administrators must issue new ones.
DELETE FROM session WHERE user_id IN (SELECT id FROM user WHERE role IN ('employee', 'staff'));
--> statement-breakpoint
UPDATE user SET must_change_password = 1 WHERE role IN ('employee', 'staff');

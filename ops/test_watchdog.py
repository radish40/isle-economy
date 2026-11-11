import unittest

from watchdog import check


class WatchdogTest(unittest.TestCase):
    def test_restarts_only_after_two_failures_and_obeys_cooldown(self):
        state, restarts = {}, []

        def down():
            raise OSError("scheduler hung")

        def tick(now, health=down):
            check(state, now, lambda: "running", health, lambda: restarts.append(now))

        tick(1000)
        tick(1060)
        tick(1120)
        tick(1180)
        self.assertEqual(restarts, [1060])
        tick(1240, lambda: "running")
        self.assertEqual(state["failures"], 0)

    def test_does_not_restart_a_responsive_paused_or_blocked_scheduler(self):
        state = {"failures": 1}

        def unexpected():
            self.fail("watchdog must not restart")

        for phase in ("pending", "version-blocked", "paused", "auto-recovering", "error-stopped"):
            check(state, 1000, lambda: "running", lambda: phase, unexpected)
            self.assertEqual(state["phase"], phase)
        check(state, 1000, lambda: "exited", unexpected, unexpected)

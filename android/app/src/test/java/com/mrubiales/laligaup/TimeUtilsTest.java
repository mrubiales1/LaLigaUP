package com.mrubiales.laligaup;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class TimeUtilsTest {
    @Test
    public void parsesUtcAndOffsetDates() {
        assertEquals(1_893_499_200_000L, TimeUtils.parse("2030-01-01T12:00:00.000Z"));
        assertEquals(1_893_499_200_000L, TimeUtils.parse("2030-01-01T13:00:00+01:00"));
    }

    @Test
    public void roundTripsMillisecondsInUtc() {
        long timestamp = 1_893_499_200_123L;
        assertEquals(timestamp, TimeUtils.parse(TimeUtils.format(timestamp)));
    }

    @Test
    public void invalidDatesNeverBecomeImmediateEpochAlarms() {
        assertTrue(TimeUtils.parse("not-a-date") == 0L);
    }
}

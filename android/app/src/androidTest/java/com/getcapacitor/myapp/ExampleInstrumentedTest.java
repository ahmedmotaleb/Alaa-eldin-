package com.getcapacitor.myapp;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Instrumented test, which will execute on an Android device.
 *
 * @see <a href="http://d.android.com/tools/testing">Testing documentation</a>
 */
@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {

    @Test
    public void useAppContext() throws Exception {
        // Context of the app under test.
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();

        // لازم يطابق applicationId الحقيقي في android/app/build.gradle — كان متسايب على
        // قيمة قالب Capacitor الافتراضية (com.getcapacitor.app)، يعني الاختبار ده كان
        // هيفشل أول ما يتشغّل كبوابة في CI.
        assertEquals("com.alaaeldin.supermarket", appContext.getPackageName());
    }
}

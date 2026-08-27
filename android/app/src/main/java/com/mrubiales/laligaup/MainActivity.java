package com.mrubiales.laligaup;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AutomationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

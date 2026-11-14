package com.rpmdelivery.courier.auth

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.rpmdelivery.courier.CourierGraph
import com.rpmdelivery.courier.work.WorkController

class CourierAuthViewModel(application: Application) : AndroidViewModel(application) {
    private val graph = CourierGraph.get(application)
    val controller = AuthController(graph.auth, viewModelScope).also { it.restore() }
    val work = WorkController(graph.work, viewModelScope, onExpired = { controller.sessionExpired() })
    // The client lives with the process: the shift service may still be using it after this screen is gone.
}

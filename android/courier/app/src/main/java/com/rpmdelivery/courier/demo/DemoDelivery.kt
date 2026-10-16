package com.rpmdelivery.courier.demo

/** Presentation fixture only. Not a route state machine or a backend contract. */
data class DemoDelivery(
    val orderNumber: String,
    val street: String,
    val neighborhood: String,
    val position: Int,
    val total: Int,
)

val sampleDelivery = DemoDelivery("1042", "Rua das Flores, 125", "Bairro Centro", 2, 4)

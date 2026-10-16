package com.rpmdelivery.courier.registration

/** Local mobile-number rules, not proof that a number exists or belongs to anyone. */
object BrazilianPhone {
    private val areaCodes = setOf(
        "11", "12", "13", "14", "15", "16", "17", "18", "19", "21", "22", "24", "27", "28",
        "31", "32", "33", "34", "35", "37", "38", "41", "42", "43", "44", "45", "46", "47", "48", "49",
        "51", "53", "54", "55", "61", "62", "63", "64", "65", "66", "67", "68", "69", "71", "73", "74", "75", "77", "79",
        "81", "82", "83", "84", "85", "86", "87", "88", "89", "91", "92", "93", "94", "95", "96", "97", "98", "99",
    )

    data class Input(val nationalDigits: String, val countryPrefixDigits: Int)

    fun parseInput(value: String): Input? {
        val raw = value.trim()
        if (raw.any { it !in '0'..'9' && !it.isWhitespace() && it !in "+().-" }) return null
        if (raw.count { it == '+' } > 1 || ('+' in raw && !raw.startsWith('+'))) return null
        val digits = raw.filter { it in '0'..'9' }
        // A national DDD 55 must never become a country code after extra typing.
        val international = raw.startsWith('+')
        if (international && !digits.startsWith("55")) return null
        val national = if (international) digits.drop(2) else digits
        return if (national.length <= 11) Input(national, if (international) 2 else 0) else null
    }

    fun isValidOptional(nationalDigits: String): Boolean = nationalDigits.isEmpty() ||
        (nationalDigits.length == 11 && nationalDigits.all { it in '0'..'9' } &&
            nationalDigits.take(2) in areaCodes && nationalDigits[2] == '9')

    /** Empty/invalid input is never converted into an invented number. No transmission. */
    fun toE164(value: String): String? = parseInput(value)?.nationalDigits?.takeIf {
        it.isNotEmpty() && isValidOptional(it)
    }?.let { "+55$it" }

    // Indices refer to the progressively formatted buffer. Compose maps cursor offsets.
    fun maskInsertions(digitCount: Int): List<Pair<Int, String>> = buildList {
        if (digitCount > 0) add(0 to "(")
        if (digitCount >= 2) add(3 to ") ")
        if (digitCount > 7) add(10 to "-")
    }

    fun format(nationalDigits: String): String = StringBuilder(nationalDigits).apply {
        maskInsertions(nationalDigits.length).forEach { (index, text) -> insert(index, text) }
    }.toString()
}

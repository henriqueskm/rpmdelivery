package com.rpmdelivery.courier.registration

import java.text.Normalizer
import java.util.Locale

data class MotorcycleModel(val id: String, val brand: String, val model: String, val aliases: List<String> = emptyList()) {
    val displayName: String get() = "$brand $model"
}

/** Small offline starter catalog, not a complete catalog of brands, years or trims. */
object MotorcycleCatalog {
    const val MODEL_MAX_LENGTH = 80
    val models = listOf(
        MotorcycleModel("honda-cg160-fan", "Honda", "CG 160 Fan", listOf("fan 160", "cg160 fan")),
        MotorcycleModel("honda-cg160-titan", "Honda", "CG 160 Titan", listOf("titan 160", "cg160 titan")),
        MotorcycleModel("honda-cg160-start", "Honda", "CG 160 Start", listOf("start 160")),
        MotorcycleModel("honda-cg125-fan", "Honda", "CG 125 Fan", listOf("fan 125")),
        MotorcycleModel("honda-cg150-titan", "Honda", "CG 150 Titan", listOf("titan 150")),
        MotorcycleModel("honda-nxr160-bros", "Honda", "NXR 160 Bros", listOf("bros 160", "broz 160")),
        MotorcycleModel("honda-pop110i", "Honda", "Pop 110i", listOf("pop 110", "pop110")),
        MotorcycleModel("honda-biz125", "Honda", "Biz 125"),
        MotorcycleModel("yamaha-factor125", "Yamaha", "Factor 125", listOf("ybr 125 factor")),
        MotorcycleModel("yamaha-factor150", "Yamaha", "Factor 150", listOf("ybr 150 factor")),
        MotorcycleModel("yamaha-fazer-fz15", "Yamaha", "Fazer FZ15", listOf("fz 15", "fazer fz 15")),
        MotorcycleModel("yamaha-fazer-fz25", "Yamaha", "Fazer FZ25", listOf("fz 25", "fazer fz 25")),
        MotorcycleModel("yamaha-xtz150-crosser", "Yamaha", "XTZ 150 Crosser", listOf("crosser 150", "xtz150")),
        MotorcycleModel("yamaha-nmax160", "Yamaha", "NMAX 160", listOf("n max 160")),
    )

    private fun normalized(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFD)
        .replace(Regex("\\p{M}+"), "").lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]+"), " ").trim()

    private val searchTerms = models.associate { model ->
        model.id to (listOf(model.displayName) + model.aliases.map { "${model.brand} $it" }).map(::normalized)
    }

    fun find(id: String?): MotorcycleModel? = models.firstOrNull { it.id == id }

    fun search(query: String): List<MotorcycleModel> {
        val tokens = normalized(query.take(MODEL_MAX_LENGTH)).split(' ').filter(String::isNotEmpty)
        return models.filter { model ->
            searchTerms.getValue(model.id).any { term -> tokens.all { term.replace(" ", "").contains(it) } }
        }
    }
}

data class MotorcycleSelection(val query: String = "", val selectedId: String? = null, val notFound: Boolean = false) {
    val selected: MotorcycleModel? get() = MotorcycleCatalog.find(selectedId)?.takeIf {
        !notFound && it.displayName == query && it.displayName.length <= MotorcycleCatalog.MODEL_MAX_LENGTH
    }

    fun edit(value: String): MotorcycleSelection = if (value == query) this else MotorcycleSelection(value)
    fun choose(id: String): MotorcycleSelection = MotorcycleCatalog.find(id)?.let {
        MotorcycleSelection(it.displayName, it.id)
    } ?: copy(selectedId = null)
    fun markNotFound(): MotorcycleSelection = copy(selectedId = null, notFound = true)
}

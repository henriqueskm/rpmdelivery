package com.rpmdelivery.courier

import com.rpmdelivery.courier.registration.MotorcycleCatalog
import com.rpmdelivery.courier.registration.MotorcycleSelection
import org.junit.Assert.*
import org.junit.Test

class MotorcycleCatalogTest {
    @Test fun catalogHasUniqueIdsAndBackendCompatibleFullNames() {
        val models = MotorcycleCatalog.models
        assertEquals(models.size, models.map { it.id }.toSet().size)
        assertEquals(setOf("Honda", "Yamaha"), models.map { it.brand }.toSet())
        assertTrue(models.all { it.displayName.length <= 80 && it.displayName.startsWith(it.brand + " ") })
    }

    @Test fun searchMatchesBrandsModelsAccentsCaseAndCommonVariants() {
        for (query in listOf("HONDA CG160 fán", "fan 160", "cg 160 fan")) {
            assertTrue(query, MotorcycleCatalog.search(query).any { it.id == "honda-cg160-fan" })
        }
        assertTrue(MotorcycleCatalog.search("títan").any { it.id == "honda-cg160-titan" })
        assertTrue(MotorcycleCatalog.search("broz 160").any { it.id == "honda-nxr160-bros" })
        assertTrue(MotorcycleCatalog.search("yámaha fz 15").any { it.id == "yamaha-fazer-fz15" })
        assertTrue(MotorcycleCatalog.search("YAMAHA").all { it.brand == "Yamaha" })
        assertEquals(MotorcycleCatalog.models, MotorcycleCatalog.search(""))
        assertTrue(MotorcycleCatalog.search("marca que não consta").isEmpty())
    }

    @Test fun arbitraryTextAndTypedExactNameAreNotASelection() {
        assertNull(MotorcycleSelection("qualquer moto").selected)
        assertNull(MotorcycleSelection("Honda CG 160 Fan").selected)
        assertNull(MotorcycleSelection("qualquer moto", "honda-cg160-fan").selected)
        assertNull(MotorcycleSelection().choose("id-inexistente").selected)
    }

    @Test fun selectingAndEditingCannotLeaveAnOldModelSelected() {
        val choice = MotorcycleSelection("fan").choose("honda-cg160-fan")
        assertEquals("Honda CG 160 Fan", choice.selected?.displayName)
        assertNull(choice.edit("Honda CG 160 F").selected)
        assertNull(choice.edit("Honda CG 160 F").edit("Honda CG 160 Fan").selected)
        assertEquals(choice, choice.edit(choice.query))
    }

    @Test fun notFoundIsAnExplicitUnselectedBranchAndCanBeRecovered() {
        val missing = MotorcycleSelection().choose("honda-cg160-fan").markNotFound()
        assertTrue(missing.notFound)
        assertNull(missing.selected)
        assertFalse(missing.edit("yamaha").notFound)
        assertNotNull(missing.choose("yamaha-factor150").selected)
        assertFalse(missing.choose("yamaha-factor150").notFound)
    }
}

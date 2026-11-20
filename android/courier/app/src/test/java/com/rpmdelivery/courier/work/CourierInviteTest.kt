package com.rpmdelivery.courier.work

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CourierInviteTest {
    private val fake = FakeWork()
    private val code = fake.inviteCode

    @Test fun readsOnlyThisSitesInviteLinks() {
        assertEquals(code, InviteLink.code("https://rpmdelivery.vercel.app/convite#c=$code"))
        assertEquals(code, InviteLink.code("https://rpmdelivery.vercel.app/convite#c=0123-4567-89AB-CDEF-0123"))
        listOf(
            "http://rpmdelivery.vercel.app/convite#c=$code",
            "https://evil.example/convite#c=$code",
            "https://rpmdelivery.vercel.app.evil.example/convite#c=$code",
            "https://user@rpmdelivery.vercel.app/convite#c=$code",
            "https://rpmdelivery.vercel.app:444/convite#c=$code",
            "https://rpmdelivery.vercel.app/convite?c=$code",
            "https://rpmdelivery.vercel.app/convite?x=1#c=$code",
            "https://rpmdelivery.vercel.app/outra#c=$code",
            "https://rpmdelivery.vercel.app/convite#c=$code&x=1",
            "https://rpmdelivery.vercel.app/convite#c=zz23456789abcdef0123",
            "https://rpmdelivery.vercel.app/convite",
            "rpmdelivery://auth/confirm?code=abcdefgh",
        ).forEach { assertNull(it, InviteLink.code(it)) }
    }

    @Test fun scannedQrCodeMayHoldTheLinkOrTheBareCode() {
        assertEquals(code, InviteLink.fromScan(" https://rpmdelivery.vercel.app/convite#c=$code\n"))
        assertEquals(code, InviteLink.fromScan("0123 4567 89ab cdef 0123"))
        assertNull(InviteLink.fromScan("https://example.com/menu"))
        assertNull(InviteLink.fromScan("0123456789abcdef012"))
    }

    @Test fun inviteWaitsForTheCouriersDayThenAsksForTheLink() = runTest {
        val work = WorkController(fake, this, onExpired = {}, refreshMillis = 3_600_000)
        work.receiveInvite(code)
        assertEquals(InvitePhase.Waiting, work.state.value.invite!!.phase)
        assertFalse("nothing is read before the courier's day is on screen", "inspect_courier_invite" in fake.calls)
        // Signing in clears the previous account's screen, never the invite.
        work.clear()
        assertEquals(InvitePhase.Waiting, work.state.value.invite!!.phase)

        work.setShown(true); runCurrent()
        val ready = work.state.value.invite!!
        assertEquals(InvitePhase.Ready, ready.phase)
        assertEquals("Pizzaria do Bairro", ready.restaurantName)
        assertFalse("checking never asks for the link", "request_courier_membership" in fake.calls)

        work.requestLink(); runCurrent()
        assertNull(work.state.value.invite)
        assertEquals("Pedido enviado para Pizzaria do Bairro. Quando a loja aprovar, ela aparece aqui.", work.state.value.notice)
        assertTrue(work.state.value.home!!.stores.any { it.name == "Pizzaria do Bairro" && !it.active })
        assertEquals(listOf(code, code), fake.inviteCodes)
        work.setShown(false)
    }

    @Test fun unavailableInviteSaysSoAndCannotBeSent() = runTest {
        val work = WorkController(fake, this, onExpired = {}, refreshMillis = 3_600_000)
        work.setShown(true)
        work.receiveInvite("ffffffffffffffffffff"); runCurrent()
        val card = work.state.value.invite!!
        assertEquals(InvitePhase.Failed, card.phase)
        assertEquals(InviteCopy.refusal("unavailable"), card.message)
        assertFalse(card.retry)
        work.requestLink(); runCurrent()
        assertFalse("request_courier_membership" in fake.calls)
        work.dismissInvite()
        assertNull(work.state.value.invite)
        work.setShown(false)
    }

    @Test fun droppedConnectionWhileSendingKeepsTheInviteToRetry() = runTest {
        val work = WorkController(fake, this, onExpired = {}, refreshMillis = 3_600_000)
        work.setShown(true)
        work.receiveInvite(code); runCurrent()
        fake.failOnce("request_courier_membership", WorkProblem.network())
        work.requestLink(); runCurrent()
        val card = work.state.value.invite!!
        assertEquals(InvitePhase.Ready, card.phase)
        assertEquals(WorkProblem.network().safeMessage, card.message)
        work.requestLink(); runCurrent()
        assertNull(work.state.value.invite)
        work.setShown(false)
    }

    @Test fun incompleteProfileCanBeCheckedAgain() = runTest {
        fake.registered = false
        val work = WorkController(fake, this, onExpired = {}, refreshMillis = 3_600_000)
        work.setShown(true)
        work.receiveInvite(code); runCurrent()
        assertEquals(InviteCopy.refusal("profile_required"), work.state.value.invite!!.message)
        assertTrue(work.state.value.invite!!.retry)
        fake.registered = true
        work.retryInvite(); runCurrent()
        assertEquals(InvitePhase.Ready, work.state.value.invite!!.phase)
        work.setShown(false)
    }

    @Test fun repeatedRequestForAnApprovedStoreSaysItIsAlreadyLinked() {
        assertEquals("Você já está vinculado a Pizzaria do Bairro.", InviteCopy.requested("Pizzaria do Bairro", "ACTIVE"))
    }
}

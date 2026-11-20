package com.rpmdelivery.courier.ui.components

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.ImageAnalysis
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.rpmdelivery.courier.work.InviteLink

/**
 * Reads a store's invite QR Code in a sheet covering three quarters of the screen, so the courier
 * still sees where they are. The camera runs only while the sheet is open; frames never leave the
 * phone and nothing is saved. [onInvite] gets the normalized code once, then the sheet closes.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InviteScanner(onInvite: (String) -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    var allowed by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    var refused by remember { mutableStateOf(false) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        allowed = granted; refused = !granted
    }
    LaunchedEffect(Unit) { if (!allowed) ask.launch(Manifest.permission.CAMERA) }
    var wrongCode by remember { mutableStateOf(false) }
    val height = with(LocalDensity.current) { (LocalWindowInfo.current.containerSize.height * 0.75f).toDp() }

    ModalBottomSheet(onDismissRequest = onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().height(height).padding(start = 20.dp, end = 20.dp, bottom = 20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("Ler QR Code do convite", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.semantics { heading() })
            Text("Aponte para o QR Code que a loja mostra no painel.", style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Box(Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color.Black), contentAlignment = Alignment.Center) {
                when {
                    allowed -> {
                        CameraReader(onValue = { value ->
                            val code = InviteLink.fromScan(value)
                            if (code != null) onInvite(code) else wrongCode = true
                        })
                        // Where to aim. The whole preview is read, the frame only guides the eye.
                        Box(Modifier.size(220.dp).border(BorderStroke(3.dp, Color.White), RoundedCornerShape(20.dp)))
                    }
                    else -> Text(
                        if (refused) "Sem acesso à câmera. Permita a câmera para este aplicativo nas configurações do celular ou digite o código do convite."
                        else "Aguardando a permissão da câmera…",
                        color = Color.White, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(24.dp))
                }
            }
            if (wrongCode) Surface(color = MaterialTheme.colorScheme.errorContainer, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
                Text("Este QR Code não é um convite do RpmDelivery.", modifier = Modifier.padding(12.dp).semantics { liveRegion = LiveRegionMode.Polite },
                    color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodyMedium)
            }
            OutlinedButton(onClick = onClose, shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)) {
                Text("Cancelar", fontSize = 16.sp)
            }
        }
    }
}

/** CameraX preview with ML Kit reading QR Codes only. Each value reaches [onValue] at most once in a row. */
@Composable
private fun CameraReader(onValue: (String) -> Unit) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val latest by rememberUpdatedState(onValue)
    val controller = remember { LifecycleCameraController(context) }
    DisposableEffect(owner) {
        val scanner = BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build())
        val main = ContextCompat.getMainExecutor(context)
        var last: String? = null
        controller.setImageAnalysisAnalyzer(main, MlKitAnalyzer(listOf(scanner), ImageAnalysis.COORDINATE_SYSTEM_ORIGINAL, main) { result ->
            val value = result.getValue(scanner)?.firstNotNullOfOrNull { it.rawValue } ?: return@MlKitAnalyzer
            if (value != last) { last = value; latest(value) }
        })
        controller.bindToLifecycle(owner)
        onDispose {
            controller.unbind()
            controller.clearImageAnalysisAnalyzer()
            scanner.close()
        }
    }
    // TextureView ("compatible") so the preview follows the rounded corners of the frame.
    AndroidView(factory = {
        PreviewView(it).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FILL_CENTER
            this.controller = controller
        }
    },
        modifier = Modifier.fillMaxSize())
}

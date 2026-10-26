import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
}

// Ключ подписи релиза: android-app/keystore.properties (в git не попадает).
// storeFile=crm.jks, storePassword=..., keyAlias=..., keyPassword=...
val keystoreProps = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "uz.polygraph.crm"
    compileSdk = 37

    defaultConfig {
        applicationId = "uz.polygraph.crm"
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "0.2.1"

        val crmUrl = (project.findProperty("crm.url") as String?).orEmpty()
        buildConfigField("String", "CRM_URL", "\"$crmUrl\"")
    }

    signingConfigs {
        if (keystoreProps.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Без keystore.properties релиз подписывается debug-ключом — годится только для теста.
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.ktx)
}

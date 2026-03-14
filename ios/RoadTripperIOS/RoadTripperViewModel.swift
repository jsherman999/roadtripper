import CoreLocation
import MapKit
import SwiftUI

@MainActor
final class TripViewModel: ObservableObject {
    static let fallbackCoordinate = CLLocationCoordinate2D(latitude: 47.6592, longitude: -92.1985)

    @Published var settings = TripSettings(tripName: "RoadTripper iPhone Trip")
    @Published var isTripRunning = false
    @Published var currentPlace = PlaceSummary(
        name: "Embarrass",
        region: "Minnesota",
        coordinate: TripViewModel.fallbackCoordinate,
        detail: "Startup fallback for the simulator when no live location is available yet."
    )
    @Published var nearbyTowns: [PlaceSummary] = []
    @Published var nearbyPOIs: [PointOfInterestSummary] = []
    @Published var feed: [NarrationEvent] = []
    @Published var statusText = "Idle"
    @Published var cameraPosition: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: TripViewModel.fallbackCoordinate,
            span: MKCoordinateSpan(latitudeDelta: 0.5, longitudeDelta: 0.5)
        )
    )

    private let locationService: LocationServiceProtocol
    private let discoveryService: DiscoveryServiceProtocol
    private let narrationService: NarrationServiceProtocol
    private var lastNarratedPlaceKey: String?

    init(
        locationService: LocationServiceProtocol,
        discoveryService: DiscoveryServiceProtocol,
        narrationService: NarrationServiceProtocol
    ) {
        self.locationService = locationService
        self.discoveryService = discoveryService
        self.narrationService = narrationService

        self.locationService.onLocationUpdate = { [weak self] coordinate in
            Task { @MainActor in
                await self?.refreshFromLiveLocation(coordinate)
            }
        }
        self.locationService.onAuthorizationChange = { [weak self] status in
            Task { @MainActor in
                self?.statusText = Self.authorizationText(status)
            }
        }

        Task {
            await bootstrapInitialLocation()
        }
    }

    func startTrip() {
        isTripRunning = true
        statusText = "Starting trip"
        locationService.requestStart()
    }

    func stopTrip() {
        isTripRunning = false
        statusText = "Stopped"
        lastNarratedPlaceKey = nil
        locationService.stop()
        narrationService.stopSpeaking()
    }

    func updateAIConfiguration(llmConfiguration: RoadTripperLLMConfiguration, ttsConfiguration: RoadTripperTTSConfiguration) {
        narrationService.updateAIConfiguration(llmConfiguration: llmConfiguration, ttsConfiguration: ttsConfiguration)
        settings.llmModelOverride = llmConfiguration.model
    }

    func applyTripPresentation(audienceBand: AudienceBand, narrationMode: NarrationMode) {
        settings.audienceBand = audienceBand
        settings.narrationMode = narrationMode
    }

    func narrateSelection(_ item: MapSelectionItem) {
        Task {
            let event = await narrationService.narrateSelection(for: item, settings: settings)
            await MainActor.run {
                feed.insert(event, at: 0)
                narrationService.speak(event, enabled: settings.speakAloud)
                cameraPosition = .region(
                    MKCoordinateRegion(
                        center: item.coordinate,
                        span: MKCoordinateSpan(latitudeDelta: 0.35, longitudeDelta: 0.35)
                    )
                )
            }

            let snapshot = await discoveryService.selectedSnapshot(at: item.coordinate)
            await MainActor.run {
                apply(snapshot, autoNarrate: false)
            }
        }
    }

    func narrateTappedCoordinate(_ coordinate: CLLocationCoordinate2D) {
        let temporarySelection = MapSelectionItem.poi(
            PointOfInterestSummary(
                name: "Selected map point",
                category: "Map tap",
                coordinate: coordinate,
                detail: "This map selection was manually chosen for narration."
            )
        )
        narrateSelection(temporarySelection)
    }

    private func refreshFromLiveLocation(_ coordinate: CLLocationCoordinate2D) async {
        statusText = "Updating from live location"
        let snapshot = await discoveryService.snapshot(around: coordinate)
        apply(snapshot, autoNarrate: true)
    }

    private func bootstrapInitialLocation() async {
        #if targetEnvironment(simulator)
        let seedCoordinate = Self.fallbackCoordinate
        #else
        let seedCoordinate = locationService.currentCoordinate ?? Self.fallbackCoordinate
        #endif
        let snapshot = await discoveryService.snapshot(around: seedCoordinate)
        apply(snapshot, autoNarrate: false)
        #if targetEnvironment(simulator)
        statusText = "Embarrass fallback ready"
        #else
        if locationService.currentCoordinate == nil {
            statusText = "Embarrass fallback ready"
        }
        #endif
        locationService.requestPreviewLocation()
    }

    private func apply(_ snapshot: TripSnapshot, autoNarrate: Bool) {
        currentPlace = snapshot.currentPlace
        nearbyTowns = snapshot.nearbyTowns
        nearbyPOIs = snapshot.nearbyPOIs
        cameraPosition = .region(
            MKCoordinateRegion(
                center: snapshot.anchorCoordinate,
                span: MKCoordinateSpan(latitudeDelta: 0.45, longitudeDelta: 0.45)
            )
        )
        statusText = isTripRunning ? "Trip running" : "Idle"

        guard autoNarrate else { return }
        let placeKey = "\(snapshot.currentPlace.name)|\(snapshot.currentPlace.region)"
        guard lastNarratedPlaceKey != placeKey else { return }
        lastNarratedPlaceKey = placeKey
        Task {
            let event = await narrationService.narrateCurrentPlace(from: snapshot, settings: settings)
            await MainActor.run {
                feed.insert(event, at: 0)
                narrationService.speak(event, enabled: settings.speakAloud)
            }
        }
    }

    static func authorizationText(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .notDetermined:
            return "Waiting for location permission"
        case .restricted, .denied:
            return "Location permission denied"
        case .authorizedAlways, .authorizedWhenInUse:
            return "Location authorized"
        @unknown default:
            return "Unknown location state"
        }
    }
}

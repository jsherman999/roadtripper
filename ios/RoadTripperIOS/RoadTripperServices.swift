import AVFoundation
import CoreLocation
import Foundation
import MapKit

protocol LocationServiceProtocol: AnyObject {
    var onLocationUpdate: ((CLLocationCoordinate2D) -> Void)? { get set }
    var onAuthorizationChange: ((CLAuthorizationStatus) -> Void)? { get set }
    var currentCoordinate: CLLocationCoordinate2D? { get }
    func requestPreviewLocation()
    func requestStart()
    func stop()
}

protocol DiscoveryServiceProtocol {
    func snapshot(around coordinate: CLLocationCoordinate2D) async -> TripSnapshot
    func selectedSnapshot(at coordinate: CLLocationCoordinate2D) async -> TripSnapshot
}

@MainActor
protocol NarrationServiceProtocol {
    func narrateCurrentPlace(from snapshot: TripSnapshot, settings: TripSettings) async -> NarrationEvent
    func narrateSelection(for selection: MapSelectionItem, settings: TripSettings) async -> NarrationEvent
    func speak(_ event: NarrationEvent, enabled: Bool)
    func stopSpeaking()
    var providerSummary: String { get }
    func updateAIConfiguration(llmConfiguration: RoadTripperLLMConfiguration, ttsConfiguration: RoadTripperTTSConfiguration)
}

final class RoadTripperLocationService: NSObject, LocationServiceProtocol, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var isContinuousTrackingRequested = false
    var onLocationUpdate: ((CLLocationCoordinate2D) -> Void)?
    var onAuthorizationChange: ((CLAuthorizationStatus) -> Void)?
    var currentCoordinate: CLLocationCoordinate2D? { manager.location?.coordinate }

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 250
    }

    func requestPreviewLocation() {
        isContinuousTrackingRequested = false
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            if let coordinate = manager.location?.coordinate {
                onLocationUpdate?(coordinate)
            } else {
                manager.requestLocation()
            }
        default:
            onAuthorizationChange?(manager.authorizationStatus)
        }
    }

    func requestStart() {
        isContinuousTrackingRequested = true
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            manager.startUpdatingLocation()
        default:
            onAuthorizationChange?(manager.authorizationStatus)
        }
    }

    func stop() {
        isContinuousTrackingRequested = false
        manager.stopUpdatingLocation()
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        onAuthorizationChange?(manager.authorizationStatus)
        if manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse {
            if isContinuousTrackingRequested {
                manager.startUpdatingLocation()
            } else {
                manager.requestLocation()
            }
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let coordinate = locations.last?.coordinate else { return }
        onLocationUpdate?(coordinate)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    }
}

struct RoadTripperDiscoveryService: DiscoveryServiceProtocol {
    private let geocoder = CLGeocoder()

    func snapshot(around coordinate: CLLocationCoordinate2D) async -> TripSnapshot {
        await buildSnapshot(around: coordinate)
    }

    func selectedSnapshot(at coordinate: CLLocationCoordinate2D) async -> TripSnapshot {
        await buildSnapshot(around: coordinate)
    }

    private func buildSnapshot(around coordinate: CLLocationCoordinate2D) async -> TripSnapshot {
        async let place = reverseGeocode(coordinate)
        async let towns = searchNearbyTowns(coordinate)
        async let pois = searchNearbyPOIs(coordinate)
        return TripSnapshot(
            anchorCoordinate: coordinate,
            currentPlace: await place,
            nearbyTowns: await towns,
            nearbyPOIs: await pois
        )
    }

    private func reverseGeocode(_ coordinate: CLLocationCoordinate2D) async -> PlaceSummary {
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        do {
            let placemarks = try await geocoder.reverseGeocodeLocation(location)
            let placemark = placemarks.first
            let name = placemark?.locality ?? placemark?.name ?? "Current location"
            let region = placemark?.administrativeArea ?? placemark?.country ?? "Unknown region"
            let detail = [placemark?.subLocality, placemark?.country].compactMap { $0 }.joined(separator: ", ")
            return PlaceSummary(name: name, region: region, coordinate: coordinate, detail: detail)
        } catch {
            return PlaceSummary(name: "Current location", region: "Unknown region", coordinate: coordinate, detail: "Live geocoder scaffold")
        }
    }

    private func searchNearbyTowns(_ coordinate: CLLocationCoordinate2D) async -> [PlaceSummary] {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = "town"
        request.resultTypes = .address
        request.region = MKCoordinateRegion(center: coordinate, latitudinalMeters: 120_000, longitudinalMeters: 120_000)

        do {
            let response = try await MKLocalSearch(request: request).start()
            let towns = response.mapItems.compactMap { item -> PlaceSummary? in
                guard let locality = item.placemark.locality ?? item.name else { return nil }
                let region = item.placemark.administrativeArea ?? item.placemark.country ?? "Unknown"
                return PlaceSummary(
                    name: locality,
                    region: region,
                    coordinate: item.placemark.coordinate,
                    detail: item.placemark.title ?? "Nearby town"
                )
            }
            return uniquePlaces(towns, limit: 6)
        } catch {
            return []
        }
    }

    private func searchNearbyPOIs(_ coordinate: CLLocationCoordinate2D) async -> [PointOfInterestSummary] {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = "point of interest"
        request.resultTypes = .pointOfInterest
        request.region = MKCoordinateRegion(center: coordinate, latitudinalMeters: 40_000, longitudinalMeters: 40_000)

        do {
            let response = try await MKLocalSearch(request: request).start()
            return Array(response.mapItems.prefix(8)).compactMap { item in
                PointOfInterestSummary(
                    name: item.name ?? "Point of interest",
                    category: item.pointOfInterestCategory?.rawValue ?? "Point of interest",
                    coordinate: item.placemark.coordinate,
                    detail: item.placemark.title ?? "Discovered nearby"
                )
            }
        } catch {
            return []
        }
    }

    private func uniquePlaces(_ places: [PlaceSummary], limit: Int) -> [PlaceSummary] {
        var seen = Set<String>()
        var result: [PlaceSummary] = []
        for place in places {
            let key = "\(place.name)|\(place.region)"
            if seen.contains(key) { continue }
            seen.insert(key)
            result.append(place)
            if result.count == limit { break }
        }
        return result
    }
}

@MainActor
final class RoadTripperNarrationService: NarrationServiceProtocol {
    private let synthesizer = AVSpeechSynthesizer()
    private var audioPlayer: AVAudioPlayer?
    private var playbackGeneration = 0
    private var llmConfiguration: RoadTripperLLMConfiguration
    private var ttsConfiguration: RoadTripperTTSConfiguration
    private var llmProvider: NarrationLLMProvider
    private var openAITTSProvider: OpenAITTSProviding?

    var providerSummary: String {
        let text = llmConfiguration.provider == .none ? "Built-in text" : "\(llmConfiguration.provider.title) text"
        let voice = ttsConfiguration.provider == .native ? "native voice" : "OpenAI voice \(ttsConfiguration.voice)"
        return "\(text), \(voice)"
    }

    init(
        llmConfiguration: RoadTripperLLMConfiguration = RoadTripperLLMConfiguration(),
        ttsConfiguration: RoadTripperTTSConfiguration = RoadTripperTTSConfiguration()
    ) {
        self.llmConfiguration = llmConfiguration.normalized()
        self.ttsConfiguration = ttsConfiguration.normalized()
        self.llmProvider = RoadTripperLLMProviderFactory.build(configuration: self.llmConfiguration)
        self.openAITTSProvider = RoadTripperTTSProviderFactory.build(
            configuration: self.ttsConfiguration,
            openAIAPIKey: self.llmConfiguration.openAIAPIKey
        )
    }

    func narrateCurrentPlace(from snapshot: TripSnapshot, settings: TripSettings) async -> NarrationEvent {
        let place = snapshot.currentPlace
        let fallbackScript: String
        switch settings.audienceBand {
        case .adult:
            fallbackScript = "Now near \(place.name), \(place.region). \(place.detail.isEmpty ? "This stop was refreshed from live location." : place.detail)."
        case .earlyElementary:
            fallbackScript = "We are close to \(place.name), \(place.region). \(place.detail.isEmpty ? "This is a nearby stop on our trip." : place.detail)."
        case .elementary:
            fallbackScript = "Welcome near \(place.name), \(place.region). \(place.detail.isEmpty ? "This is one of the places on our route." : place.detail)."
        }
        let context = NarrationLLMContext(
            ageBand: settings.audienceBand.rawValue,
            narrationMode: settings.narrationMode.rawValue,
            sourceKind: "current_place",
            sourceName: place.name,
            region: place.region,
            detail: place.detail
        )
        let finalScript = await llmProvider.generateNarration(
            fallbackScript: fallbackScript,
            context: context,
            modelOverride: settings.llmModelOverride
        ) ?? fallbackScript
        return NarrationEvent(
            title: "Current place: \(place.name)",
            script: finalScript,
            timestamp: .now,
            coordinate: place.coordinate,
            sourceName: place.name
        )
    }

    func narrateSelection(for selection: MapSelectionItem, settings: TripSettings) async -> NarrationEvent {
        let prefix: String
        switch settings.audienceBand {
        case .adult:
            prefix = "Selected location"
        case .earlyElementary:
            prefix = "You picked"
        case .elementary:
            prefix = "You tapped"
        }
        let fallbackScript = "\(prefix): \(selection.title), \(selection.subtitle). \(selection.detail)"
        let context = NarrationLLMContext(
            ageBand: settings.audienceBand.rawValue,
            narrationMode: settings.narrationMode.rawValue,
            sourceKind: selection.kindLabel,
            sourceName: selection.title,
            region: selection.subtitle,
            detail: selection.detail
        )
        let finalScript = await llmProvider.generateNarration(
            fallbackScript: fallbackScript,
            context: context,
            modelOverride: settings.llmModelOverride
        ) ?? fallbackScript
        return NarrationEvent(
            title: "Selected: \(selection.title)",
            script: finalScript,
            timestamp: .now,
            coordinate: selection.coordinate,
            sourceName: selection.title
        )
    }

    func speak(_ event: NarrationEvent, enabled: Bool) {
        guard enabled else { return }
        stopSpeaking()
        playbackGeneration += 1
        let generation = playbackGeneration

        guard ttsConfiguration.provider == .openai, let openAITTSProvider else {
            playWithSystemSpeech(event.script)
            return
        }

        let instructions = "Speak in a warm, natural, engaging road trip narrator voice. Keep the pacing clear for passengers in a moving car."
        Task {
            let data = await openAITTSProvider.synthesize(
                text: event.script,
                configuration: ttsConfiguration,
                instructions: instructions
            )

            await MainActor.run {
                guard generation == self.playbackGeneration else { return }
                guard let data else {
                    self.playWithSystemSpeech(event.script)
                    return
                }
                do {
                    try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
                    try AVAudioSession.sharedInstance().setActive(true)
                    self.audioPlayer = try AVAudioPlayer(data: data)
                    self.audioPlayer?.prepareToPlay()
                    self.audioPlayer?.play()
                } catch {
                    self.playWithSystemSpeech(event.script)
                }
            }
        }
    }

    func stopSpeaking() {
        playbackGeneration += 1
        audioPlayer?.stop()
        audioPlayer = nil
        synthesizer.stopSpeaking(at: .immediate)
    }

    func updateAIConfiguration(llmConfiguration: RoadTripperLLMConfiguration, ttsConfiguration: RoadTripperTTSConfiguration) {
        self.llmConfiguration = llmConfiguration.normalized()
        self.ttsConfiguration = ttsConfiguration.normalized()
        llmProvider = RoadTripperLLMProviderFactory.build(configuration: llmConfiguration)
        openAITTSProvider = RoadTripperTTSProviderFactory.build(
            configuration: self.ttsConfiguration,
            openAIAPIKey: self.llmConfiguration.openAIAPIKey
        )
    }

    private func playWithSystemSpeech(_ text: String) {
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = 0.48
        utterance.pitchMultiplier = 1.0
        synthesizer.stopSpeaking(at: .immediate)
        synthesizer.speak(utterance)
    }
}

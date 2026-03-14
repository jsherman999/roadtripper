import MapKit
import SwiftUI

struct RoadTripperRootView: View {
    @ObservedObject var viewModel: TripViewModel
    @ObservedObject var settingsStore: RoadTripperLLMSettingsStore
    @State private var isShowingSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    controlCard
                    mapCard
                    nearbySection
                    feedSection
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .background(backgroundGradient)
            .preferredColorScheme(.dark)
            .navigationTitle("RoadTripper")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        isShowingSettings = true
                    } label: {
                        Image(systemName: "slider.horizontal.3")
                            .font(.system(size: 15, weight: .semibold))
                    }
                }
            }
            .sheet(isPresented: $isShowingSettings) {
                RoadTripperSettingsView(
                    settingsStore: settingsStore,
                    initialAudienceBand: viewModel.settings.audienceBand,
                    initialNarrationMode: viewModel.settings.narrationMode,
                    onSave: { audienceBand, narrationMode in
                        viewModel.applyTripPresentation(audienceBand: audienceBand, narrationMode: narrationMode)
                        viewModel.updateAIConfiguration(
                            llmConfiguration: settingsStore.configuration,
                            ttsConfiguration: settingsStore.ttsConfiguration
                        )
                    },
                    onClose: {
                        isShowingSettings = false
                    }
                )
            }
        }
    }

    private var controlCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Trip")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)

                    TextField("Road trip name", text: $viewModel.settings.tripName)
                        .textFieldStyle(.plain)
                        .font(.system(size: 17, weight: .semibold, design: .rounded))
                }

                Spacer(minLength: 12)

                statusPill
            }

            HStack(spacing: 8) {
                compactToggle(
                    title: "Speak",
                    systemImage: viewModel.settings.speakAloud ? "speaker.wave.2.fill" : "speaker.slash.fill",
                    isOn: $viewModel.settings.speakAloud
                )
                compactToggle(
                    title: "Save",
                    systemImage: viewModel.settings.saveHistory ? "bookmark.fill" : "bookmark",
                    isOn: $viewModel.settings.saveHistory
                )
            }

            HStack(spacing: 10) {
                Button {
                    viewModel.startTrip()
                } label: {
                    Label(viewModel.isTripRunning ? "Running" : "Start", systemImage: "play.fill")
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.blue)
                .disabled(viewModel.isTripRunning)

                Button {
                    viewModel.stopTrip()
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(!viewModel.isTripRunning)
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color.white.opacity(0.06))
                .overlay(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .stroke(Color.white.opacity(0.06), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.25), radius: 18, y: 10)
        )
    }

    private var mapCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Live Map")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                    Text(viewModel.currentPlace.name)
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                }
                Spacer()
                Image(systemName: "location.fill.viewfinder")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.blue)
            }

            MapReader { proxy in
                Map(position: $viewModel.cameraPosition) {
                    Annotation(viewModel.currentPlace.name, coordinate: viewModel.currentPlace.coordinate) {
                        mapPin(title: viewModel.currentPlace.name, color: .teal)
                            .onTapGesture {
                                viewModel.narrateSelection(.currentPlace(viewModel.currentPlace))
                            }
                    }
                    ForEach(viewModel.nearbyTowns) { town in
                        Annotation(town.name, coordinate: town.coordinate) {
                            mapPin(title: town.name, color: .blue)
                                .onTapGesture {
                                    viewModel.narrateSelection(.nearbyTown(town))
                                }
                        }
                    }
                    ForEach(viewModel.nearbyPOIs) { poi in
                        Annotation(poi.name, coordinate: poi.coordinate) {
                            mapPin(title: poi.name, color: .orange)
                                .onTapGesture {
                                    viewModel.narrateSelection(.poi(poi))
                                }
                        }
                        }
                }
                .mapStyle(.standard(elevation: .realistic))
                .frame(height: 430)
                .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
                .overlay(alignment: .topLeading) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(viewModel.currentPlace.name), \(viewModel.currentPlace.region)")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                            .foregroundStyle(.primary)
                        if !viewModel.currentPlace.detail.isEmpty {
                            Text(viewModel.currentPlace.detail)
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: 250, alignment: .leading)
                    .background(Color.black.opacity(0.48), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .padding(14)
                }
                .overlay(alignment: .bottomLeading) {
                    HStack(spacing: 8) {
                        mapInfoChip(
                            systemImage: "building.2.fill",
                            text: "\(viewModel.nearbyTowns.count) towns"
                        )
                        mapInfoChip(
                            systemImage: "mappin.and.ellipse",
                            text: "\(viewModel.nearbyPOIs.count) places"
                        )
                        mapInfoChip(
                            systemImage: "waveform",
                            text: viewModel.isTripRunning ? "Live" : "Idle"
                        )
                    }
                    .padding(14)
                }
                .gesture(
                    SpatialTapGesture()
                        .onEnded { value in
                            if let coordinate = proxy.convert(value.location, from: .local) {
                                viewModel.narrateTappedCoordinate(coordinate)
                            }
                        }
                )
            }
            Text("Tap the map or a pin to hear narration and add it to the trip.")
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .fill(Color.white.opacity(0.05))
                .overlay(
                    RoundedRectangle(cornerRadius: 30, style: .continuous)
                        .stroke(Color.white.opacity(0.05), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.28), radius: 20, y: 12)
        )
    }

    private var nearbySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Nearby")
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                Spacer()
                Text("Tap a card to narrate")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(viewModel.nearbyTowns) { town in
                        Button {
                            viewModel.narrateSelection(.nearbyTown(town))
                        } label: {
                            nearbyCard(
                                title: town.name,
                                subtitle: town.region,
                                detail: town.detail,
                                symbol: "building.2.fill",
                                tint: .blue
                            )
                        }
                        .buttonStyle(.plain)
                    }

                    ForEach(viewModel.nearbyPOIs) { poi in
                        Button {
                            viewModel.narrateSelection(.poi(poi))
                        } label: {
                            nearbyCard(
                                title: poi.name,
                                subtitle: poi.category,
                                detail: poi.detail,
                                symbol: "mappin.and.ellipse",
                                tint: .orange
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 1)
            }

            if viewModel.nearbyTowns.isEmpty && viewModel.nearbyPOIs.isEmpty {
                Text("Nearby towns and places will appear here as the trip updates.")
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        }
    }

    private var feedSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Narration Feed")
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                Spacer()
                Text("\(viewModel.feed.count)")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Color.blue.opacity(0.12), in: Capsule())
                    .foregroundStyle(.blue)
            }

            if viewModel.feed.isEmpty {
                Text("Start a trip to begin building the narration feed.")
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(.secondary)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            } else {
                ForEach(viewModel.feed) { event in
                    Button {
                        viewModel.narrateTappedCoordinate(event.coordinate)
                    } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(event.title)
                                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                                Spacer()
                                Text(event.timestamp.formatted(date: .omitted, time: .shortened))
                                    .font(.system(size: 11, weight: .medium, design: .rounded))
                                    .foregroundStyle(.secondary)
                            }
                            Text(event.script)
                                .font(.system(size: 13, weight: .medium, design: .rounded))
                                .foregroundStyle(.primary.opacity(0.92))
                            Text(event.sourceName)
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var backgroundGradient: some View {
        LinearGradient(
            colors: [
                Color(red: 0.05, green: 0.06, blue: 0.09),
                Color(red: 0.07, green: 0.09, blue: 0.12),
                Color(red: 0.03, green: 0.11, blue: 0.18)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
    }

    private var statusPill: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(viewModel.isTripRunning ? .green : .secondary.opacity(0.6))
                .frame(width: 8, height: 8)
            Text(viewModel.statusText)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.primary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Color.white.opacity(0.08), in: Capsule())
    }

    private func compactToggle(title: String, systemImage: String, isOn: Binding<Bool>) -> some View {
        Button {
            isOn.wrappedValue.toggle()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .semibold))
                Text(title)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                Spacer(minLength: 0)
                Image(systemName: isOn.wrappedValue ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 14, weight: .semibold))
            }
            .foregroundStyle(isOn.wrappedValue ? Color.blue : Color.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                (isOn.wrappedValue ? Color.blue.opacity(0.18) : Color.white.opacity(0.06)),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
        }
        .buttonStyle(.plain)
    }

    private func mapInfoChip(systemImage: String, text: String) -> some View {
        Label(text, systemImage: systemImage)
            .font(.system(size: 11, weight: .semibold, design: .rounded))
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(.ultraThinMaterial, in: Capsule())
    }

    private func nearbyCard(
        title: String,
        subtitle: String,
        detail: String,
        symbol: String,
        tint: Color
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: symbol)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(tint)
                Spacer()
                Image(systemName: "speaker.wave.2.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            Text(title)
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .lineLimit(1)
            Text(subtitle)
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(detail)
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(3)
        }
        .frame(width: 188, height: 138, alignment: .topLeading)
        .padding(14)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(Color.white.opacity(0.05), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.22), radius: 12, y: 8)
    }

    private func mapPin(title: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Image(systemName: "mappin.circle.fill")
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(color)
            Text(title)
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(.thinMaterial)
                .clipShape(Capsule())
        }
    }
}

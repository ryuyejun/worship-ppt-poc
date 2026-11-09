package org.localchurch.worship.song.service;

import lombok.RequiredArgsConstructor;

import org.localchurch.worship.song.SongRequests;
import org.localchurch.worship.song.dto.response.*;
import org.localchurch.worship.song.repository.SongOperationsRepository;
import org.localchurch.worship.song.repository.SongRepository;
import org.springframework.stereotype.Service;

import java.sql.SQLException;
import java.util.List;

@Service
@RequiredArgsConstructor
public class SongService {
    private final SongRepository repository;
    private final SongOperationsRepository operations;

    public SongSearchResult search(String title, String author) throws SQLException {
        return operations.search(title, author);
    }

    public List<SongListResponse> all() throws SQLException {
        return repository.findAllByOrderByTitleAscIdAsc().stream()
                .map(
                        song ->
                                new SongListResponse(
                                        song.getId(),
                                        song.getTitle(),
                                        song.getLyricist(),
                                        song.getComposer(),
                                        song.getArtist(),
                                        song.getStatus(),
                                        song.getCategory(),
                                        song.getHymnNumber()))
                .toList();
    }

    public List<SongListResponse> pptReady() throws SQLException {
        return repository.findPptReadySongs().stream()
                .map(song -> new SongListResponse(
                        song.getId(), song.getTitle(), song.getLyricist(), song.getComposer(),
                        song.getArtist(), song.getStatus(), song.getCategory(), song.getHymnNumber()))
                .toList();
    }

    public List<SongRequests.Request> pending(String query) throws SQLException {
        return operations.pending(query);
    }

    public void complete(long id, long songId) throws SQLException {
        operations.complete(id, songId);
    }
}
